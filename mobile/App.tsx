import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SectionList,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  Modal,
  Animated,
  Share,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
// expo-image instead of RN's built-in Image for avatars: it caches decoded
// images to disk/memory, so switching tabs or reopening a run detail no
// longer re-downloads/re-decodes the same avatar every time.
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import axios from 'axios';
import { useFonts, Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { Sora_600SemiBold, Sora_800ExtraBold } from '@expo-google-fonts/sora';
import * as SplashScreen from 'expo-splash-screen';

// Keep the native splash (the branded green-on-dark footsteps mark) up
// until fonts are loaded and the saved session has been checked - without
// this, Expo hides it as soon as the first frame is up, which used to be a
// blank/system-font flash before RunApp's own UI was actually ready.
SplashScreen.preventAutoHideAsync().catch(() => {});
import {
  LOCATION_TASK_NAME,
  ACTIVE_RUN_ID_KEY,
  ACTIVE_RUN_STARTED_AT_KEY,
  readRunPoints,
  clearRunBuffer,
  getLiveRunStats,
  RunPoint,
  RunStats,
} from './locationTask';
import LeafletMap from './LeafletMap';
import LiveLeafletMap, { LiveLeafletMapHandle } from './LiveLeafletMap';
import {
  setupNotificationChannels,
  requestNotificationPermission,
  updateRunNotification,
  dismissRunNotification,
  refreshDailyRecapNotification,
} from './notifications';
import { colors, font, radius, space, shadow } from './theme';
import PressableScale from './ui/PressableScale';
import EmptyState from './ui/EmptyState';
import SegmentedControl from './ui/SegmentedControl';
import Avatar from './ui/Avatar';
import PulseDot from './ui/PulseDot';
import AppAlertHost, { showAlert } from './ui/AppAlert';
import { SkeletonBlock } from './ui/Skeleton';

const WEEKLY_GOAL_KEY = 'runapp_weekly_goal_km';
const DEFAULT_WEEKLY_GOAL_KM = 20;

const SERVER_URL = 'https://api-run.xisd.uz';

// A single shared axios instance instead of creating a new one on every
// call (the old getApi() did `axios.create(...)` per request) - this also
// lets us set a timeout (there was none before, so a hung server response
// meant the app would wait forever) and centralize auth/error handling:
// the token is attached per-request from `currentToken` (kept in sync with
// React state via an effect below) rather than baked into the instance at
// creation time, and a 401 anywhere triggers an automatic logout instead of
// every screen's fetch silently failing forever against a dead token.
const api = axios.create({ baseURL: SERVER_URL, timeout: 15000 });
let currentToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

api.interceptors.request.use((config) => {
  if (currentToken) {
    config.headers = config.headers ?? ({} as any);
    (config.headers as any).Authorization = `Bearer ${currentToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

interface UserInfo {
  id: string;
  username: string;
  avatarUrl: string | null;
  isBanned?: boolean;
  bannedReason?: string | null;
}

interface RunDetail extends Run {
  path: RunPoint[];
  flaggedSegments: number;
  plannedRoutePath?: RunPoint[] | null;
  plannedDistanceMeters?: number | null;
}

interface SuggestedRoute {
  distanceMeters: number;
  durationSec: number;
  path: RunPoint[];
}

interface Stats {
  totalDistanceM: number;
  totalRuns: number;
  totalPoints: number;
  bestMaxSpeedKmh: number;
  currentStreakDays: number;
  longestStreakDays: number;
  avgSpeedKmh: number;
  todayDistanceM: number;
  weekDistanceM: number;
  monthDistanceM: number;
}

interface Run {
  id: string;
  startedAt: string;
  distanceMeters: number;
  durationSec: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  pointsEarned: number;
  flaggedSegments?: number;
}

interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatarUrl: string | null;
  distanceMeters: number;
  points: number;
}

type Period = 'daily' | 'weekly' | 'alltime';
type Screen = 'home' | 'leaderboard' | 'history' | 'plan' | 'profile';

const PLAN_DISTANCES = [1, 2, 3, 5, 10];

function formatKm(meters: number) {
  return (meters / 1000).toFixed(2);
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Xayrli tun';
  if (h < 12) return 'Xayrli tong';
  if (h < 18) return 'Xayrli kun';
  return 'Xayrli kech';
}

function formatRunDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(d, now)) return 'Bugun';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Kecha';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function lastSegmentTooFast(points: RunPoint[]): boolean {
  if (points.length < 2) return false;
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const meters = 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
  const seconds = (b.ts - a.ts) / 1000;
  if (meters >= 200 || seconds <= 0) return false;
  const speedKmh = meters / 1000 / (seconds / 3600);
  return speedKmh > 40;
}

function AppInner() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const [fontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    Sora_600SemiBold,
    Sora_800ExtraBold,
  });

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);

  const [screen, setScreen] = useState<Screen>('home');

  const [stats, setStats] = useState<Stats | null>(null);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [isLoadingHome, setIsLoadingHome] = useState(false);
  const [homeError, setHomeError] = useState(false);

  const [period, setPeriod] = useState<Period>('daily');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState(false);
  const [myRank, setMyRank] = useState<{ rank: number | null; entry: LeaderboardEntry | null }>({ rank: null, entry: null });

  const [historyRuns, setHistoryRuns] = useState<Run[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [isLoadingRunDetail, setIsLoadingRunDetail] = useState(false);

  const [planTargetKm, setPlanTargetKm] = useState(5);
  const [isLocatingForPlan, setIsLocatingForPlan] = useState(false);
  const [isSuggestingRoute, setIsSuggestingRoute] = useState(false);
  const [suggestedRoute, setSuggestedRoute] = useState<SuggestedRoute | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const [liveSpeedWarning, setLiveSpeedWarning] = useState(false);

  const [profileUsername, setProfileUsername] = useState('');
  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  const [isRunModalVisible, setIsRunModalVisible] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [livePoints, setLivePoints] = useState<RunPoint[]>([]);
  const [liveStats, setLiveStats] = useState<RunStats>({ distanceMeters: 0, durationSec: 0, avgSpeedKmh: 0, maxSpeedKmh: 0 });
  const [activePlannedRoute, setActivePlannedRoute] = useState<SuggestedRoute | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [isFinishingRun, setIsFinishingRun] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveMapRef = useRef<LiveLeafletMapHandle>(null);
  const sentPointCountRef = useRef(0);
  const lastNotifUpdateRef = useRef(0);
  const leaderboardAbortRef = useRef<AbortController | null>(null);

  const [isOffline, setIsOffline] = useState(false);
  const screenFade = useRef(new Animated.Value(1)).current;

  const [weeklyGoalKm, setWeeklyGoalKm] = useState(DEFAULT_WEEKLY_GOAL_KM);
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState(String(DEFAULT_WEEKLY_GOAL_KM));

  const newPasswordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  // getApi() kept as the call-site API (every screen still calls
  // getApi().get/post/patch(...) exactly as before) but now just hands back
  // the one shared, pre-configured instance above.
  const getApi = useCallback(() => api, []);

  useEffect(() => {
    currentToken = token;
  }, [token]);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedToken = await SecureStore.getItemAsync('runapp_jwt_token');
        if (savedToken) {
          setToken(savedToken);
          api
            .get('/auth/me', { headers: { Authorization: `Bearer ${savedToken}` } })
            .then((res) => setCurrentUser(res.data))
            .catch((err) => console.warn('Failed to refresh session user:', err?.message));
        }
      } catch (err) {
        console.warn('Failed to restore session:', err);
      } finally {
        setIsInitializing(false);
      }
    };
    restoreSession();
  }, []);

  useEffect(() => {
    setupNotificationChannels();
  }, []);

  // A network blip used to just make screens fail silently (empty catch
  // blocks) with no indication of why nothing was loading. A persistent
  // banner makes "why is this stuck" obvious instead of looking broken.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(WEEKLY_GOAL_KEY)
      .then((saved) => {
        const parsed = saved ? parseFloat(saved) : NaN;
        if (!Number.isNaN(parsed) && parsed > 0) {
          setWeeklyGoalKm(parsed);
          setGoalInput(String(parsed));
        }
      })
      .catch(() => {});
  }, []);

  const saveWeeklyGoal = () => {
    const parsed = parseFloat(goalInput.replace(',', '.'));
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 500) {
      setWeeklyGoalKm(parsed);
      AsyncStorage.setItem(WEEKLY_GOAL_KEY, String(parsed)).catch(() => {});
    } else {
      setGoalInput(String(weeklyGoalKm));
    }
    setIsEditingGoal(false);
  };

  // A hard cut between tabs (the old behavior) is fine, but a quick
  // fade-through makes switching screens feel like a designed transition
  // instead of a plain state swap - and doubles as the tab bar's haptic tick.
  const switchScreen = (next: Screen) => {
    if (next === screen) return;
    Haptics.selectionAsync().catch(() => {});
    Animated.timing(screenFade, { toValue: 0, duration: 90, useNativeDriver: true }).start(() => {
      setScreen(next);
      Animated.timing(screenFade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    });
  };

  // If the app was killed/relaunched mid-run, reopen the tracking screen instead
  // of silently losing track of it.
  useEffect(() => {
    const restoreActiveRun = async () => {
      const [runId, startedAt] = await Promise.all([
        AsyncStorage.getItem(ACTIVE_RUN_ID_KEY),
        AsyncStorage.getItem(ACTIVE_RUN_STARTED_AT_KEY),
      ]);
      if (runId && startedAt) {
        setActiveRunId(runId);
        setRunStartedAt(Number(startedAt));
        setIsRunModalVisible(true);
      }
    };
    restoreActiveRun();
  }, []);

  // While the run screen is open, poll the local point buffer (written by the
  // background location task) so distance/time/pace stay live.
  useEffect(() => {
    if (!isRunModalVisible) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    const poll = async () => {
      const points = await readRunPoints();
      setLivePoints(points);
      // getLiveRunStats() reads running totals kept up to date by the
      // background task as points arrive - O(1), instead of re-walking the
      // whole path with haversine math on every 2s tick like computeRunStats
      // (still fine for a one-off full recompute, just not every tick).
      setLiveStats(getLiveRunStats());
      setNowTick(Date.now());
      setLiveSpeedWarning(lastSegmentTooFast(points));
      if (points.length > sentPointCountRef.current) {
        for (let i = sentPointCountRef.current; i < points.length; i++) {
          liveMapRef.current?.addPoint({ lat: points[i].lat, lng: points[i].lng });
        }
        sentPointCountRef.current = points.length;
      }

      const now = Date.now();
      if (now - lastNotifUpdateRef.current > 10000) {
        lastNotifUpdateRef.current = now;
        const liveStats = getLiveRunStats();
        const elapsedSec = runStartedAt ? Math.max(0, Math.floor((now - runStartedAt) / 1000)) : 0;
        updateRunNotification(liveStats.distanceMeters, elapsedSec, liveStats.avgSpeedKmh || 0);
      }
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isRunModalVisible]);

  const fetchHome = useCallback(async () => {
    if (!token) return;
    setIsLoadingHome(true);
    setHomeError(false);
    try {
      const [statsRes, runsRes] = await Promise.all([
        getApi().get('/auth/stats'),
        getApi().get('/runs/me?limit=6'),
      ]);
      setStats(statsRes.data);
      setRecentRuns(runsRes.data);
      refreshDailyRecapNotification(statsRes.data);
    } catch (err: any) {
      console.warn('fetchHome failed:', err?.message);
      setHomeError(true);
    } finally {
      setIsLoadingHome(false);
    }
  }, [token, getApi]);

  useEffect(() => {
    if (token && screen === 'home') fetchHome();
  }, [token, screen, fetchHome]);

  // Profile's "Rekordlar" card reads from the same `stats` the Home tab
  // fetches - load it here too in case Profile is opened first (e.g. right
  // after login) and Home never ran its own fetch yet.
  useEffect(() => {
    if (token && screen === 'profile' && !stats) fetchHome();
  }, [token, screen, stats, fetchHome]);

  const fetchLeaderboard = useCallback(async () => {
    if (!token) return;
    // Cancel a still-in-flight request from a previous period switch so a
    // slower "daily" response can't land after a faster "weekly" one and
    // overwrite it with stale data.
    leaderboardAbortRef.current?.abort();
    const controller = new AbortController();
    leaderboardAbortRef.current = controller;

    setIsLoadingLeaderboard(true);
    setLeaderboardError(false);
    try {
      const [boardRes, meRes] = await Promise.all([
        getApi().get(`/leaderboard?period=${period}`, { signal: controller.signal }),
        getApi().get(`/leaderboard/me?period=${period}`, { signal: controller.signal }),
      ]);
      setLeaderboard(boardRes.data);
      setMyRank(meRes.data);
    } catch (err: any) {
      if (axios.isCancel(err) || err?.code === 'ERR_CANCELED') return;
      console.warn('fetchLeaderboard failed:', err?.message);
      setLeaderboardError(true);
    } finally {
      if (leaderboardAbortRef.current === controller) setIsLoadingLeaderboard(false);
    }
  }, [token, getApi, period]);

  useEffect(() => {
    if (token && screen === 'leaderboard') fetchLeaderboard();
  }, [token, screen, period, fetchLeaderboard]);

  const fetchHistory = useCallback(async () => {
    if (!token) return;
    setIsLoadingHistory(true);
    setHistoryError(false);
    try {
      // Server clamps this to 100 regardless; kept requesting the same
      // number here just so this isn't the only place that would need to
      // change if that cap moves.
      const res = await getApi().get('/runs/me?limit=100');
      setHistoryRuns(res.data);
    } catch (err: any) {
      console.warn('fetchHistory failed:', err?.message);
      setHistoryError(true);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [token, getApi]);

  useEffect(() => {
    if (token && screen === 'history') fetchHistory();
  }, [token, screen, fetchHistory]);

  // Grouped by calendar month so a long history reads as "September, August,
  // July…" instead of one undifferentiated scroll of rows - the list is
  // already sorted newest-first by the server, so this only needs to bucket
  // it, not re-sort anything.
  const historySections = useMemo(() => {
    const order: string[] = [];
    const groups = new Map<string, Run[]>();
    for (const run of historyRuns) {
      const key = new Date(run.startedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key)!.push(run);
    }
    return order.map((title) => ({ title, data: groups.get(title)! }));
  }, [historyRuns]);

  const openRunDetail = async (runId: string) => {
    setIsLoadingRunDetail(true);
    setSelectedRun(null);
    try {
      const res = await getApi().get(`/runs/${runId}`);
      setSelectedRun(res.data);
    } catch {
      showAlert('Xato', "Bu yugurishni yuklab bo'lmadi");
    } finally {
      setIsLoadingRunDetail(false);
    }
  };

  const handleSuggestRoute = async () => {
    setPlanError(null);
    setSuggestedRoute(null);
    setIsLocatingForPlan(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setPlanError("Yaqiningizdan yo'nalish taklif qilish uchun joylashuvga ruxsat kerak.");
        return;
      }
      const position = await Promise.race([
        Location.getCurrentPositionAsync({}),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('location_timeout')), 10000)),
      ]);
      setIsLocatingForPlan(false);
      setIsSuggestingRoute(true);
      const res = await getApi().post('/routes/suggest', {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        targetKm: planTargetKm,
      });
      setSuggestedRoute(res.data);
    } catch (err: any) {
      if (err?.message === 'location_timeout') {
        setPlanError("Joylashuvni aniqlash vaqti tugadi. GPS yoqilganligiga ishonch hosil qiling va qayta urinib ko'ring.");
      } else {
        setPlanError(err.response?.data?.message || "Yaqiningizda yo'nalish yaratib bo'lmadi");
      }
    } finally {
      setIsLocatingForPlan(false);
      setIsSuggestingRoute(false);
    }
  };

  useEffect(() => {
    if (screen === 'profile') {
      setProfileUsername(currentUser?.username || '');
    }
  }, [screen, currentUser?.username]);

  const handleAuthSubmit = async () => {
    if (!username || !password) {
      showAlert('Xato', "Barcha maydonlarni to'ldiring");
      return;
    }
    setIsSubmittingAuth(true);
    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const res = await api.post(endpoint, { username, password });
      const jwtToken = res.data.access_token;
      await SecureStore.setItemAsync('runapp_jwt_token', jwtToken);
      await AsyncStorage.setItem('runapp_server_url', SERVER_URL);
      setToken(jwtToken);
      setCurrentUser(res.data.user);
      setScreen('home');
    } catch (err: any) {
      const msg = err.response?.data?.message || `${authMode === 'login' ? 'Kirishda' : "Ro'yxatdan o'tishda"} xatolik yuz berdi.`;
      showAlert('Xato', Array.isArray(msg) ? msg.join('\n') : msg);
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync('runapp_jwt_token');
    setToken(null);
    setCurrentUser(null);
    setScreen('home');
  };

  const handleLogoutRef = useRef(handleLogout);
  handleLogoutRef.current = handleLogout;

  // A 401 from any request (expired/invalid token) used to just make every
  // screen's fetch silently fail forever via its own empty catch{} - the
  // user stayed stuck on a blank dashboard with no way to tell why. Now it
  // logs them out automatically so they can sign back in.
  useEffect(() => {
    onUnauthorized = () => handleLogoutRef.current();
    return () => {
      onUnauthorized = null;
    };
  }, []);

  const handlePickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Ruxsat kerak', "Profil rasmini o'zgartirish uchun galereyaga ruxsat bering.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const formData = new FormData();
    formData.append('file', {
      uri: asset.uri,
      name: asset.fileName || 'avatar.jpg',
      type: asset.mimeType || 'image/jpeg',
    } as any);

    setIsUploadingAvatar(true);
    try {
      const res = await getApi().post('/auth/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setCurrentUser(res.data);
    } catch (err: any) {
      showAlert('Xato', err.response?.data?.message || "Rasmni yuklab bo'lmadi");
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSaveUsername = async () => {
    if (!profileUsername.trim() || profileUsername === currentUser?.username) return;
    setIsSavingUsername(true);
    try {
      const res = await getApi().patch('/auth/profile', { username: profileUsername.trim() });
      setCurrentUser(res.data);
      showAlert('Saqlandi', 'Foydalanuvchi nomi yangilandi!');
    } catch (err: any) {
      showAlert('Xato', err.response?.data?.message || "Foydalanuvchi nomini yangilab bo'lmadi");
    } finally {
      setIsSavingUsername(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPasswordInput !== confirmPasswordInput) {
      showAlert('Xato', 'Yangi parollar mos kelmadi');
      return;
    }
    setIsSavingPassword(true);
    try {
      await getApi().post('/auth/change-password', {
        currentPassword: currentPasswordInput,
        newPassword: newPasswordInput,
      });
      showAlert('Muvaffaqiyatli', "Parol muvaffaqiyatli o'zgartirildi!");
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
    } catch (err: any) {
      showAlert('Xato', err.response?.data?.message || "Parolni o'zgartirib bo'lmadi");
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleStartRun = async (plannedRoute?: SuggestedRoute) => {
    setIsStartingRun(true);
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== 'granted') {
        showAlert('Ruxsat kerak', 'Yugurishni kuzatish uchun joylashuvga ruxsat kerak.');
        return;
      }

      const existingBackground = await Location.getBackgroundPermissionsAsync();
      if (existingBackground.status !== 'granted') {
        // Android 11+ won't grant "Allow all the time" from a simple popup - it
        // sends the user into system Settings instead. Explain that up front
        // so it doesn't look like the app just crashed/kicked them out.
        await new Promise<void>((resolve) => {
          showAlert(
            'Yana bir qadam',
            'Keyingi ekranda joylashuv uchun "Har doim ruxsat berish"ni tanlang, shunda ekran qulflansa ham yozib olish davom etadi. Bu Sozlamalarni ochishi mumkin — u yerda ruxsat berganingizdan so\'ng, qaytib yana Yugurishni boshlashni bosing.',
            [{ text: 'Davom etish', onPress: () => resolve() }],
          );
        });

        const background = await Location.requestBackgroundPermissionsAsync();
        if (background.status !== 'granted') {
          return;
        }
      }

      // Needed both for the "Recording your run…" foreground-service
      // notification and the live-stats notification updated during tracking.
      await requestNotificationPermission();

      const res = await getApi().post('/runs/start', plannedRoute
        ? { plannedRoutePath: plannedRoute.path, plannedDistanceMeters: plannedRoute.distanceMeters }
        : {});
      const runId = res.data.id as string;
      const startedAt = Date.now();

      await clearRunBuffer();
      await AsyncStorage.setItem(ACTIVE_RUN_ID_KEY, runId);
      await AsyncStorage.setItem(ACTIVE_RUN_STARTED_AT_KEY, String(startedAt));

      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 8,
        timeInterval: 4000,
        foregroundService: {
          notificationTitle: 'RunApp',
          notificationBody: 'Yugurishingiz yozilmoqda…',
          notificationColor: colors.accent,
        },
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
      });

      setActiveRunId(runId);
      setRunStartedAt(startedAt);
      setLivePoints([]);
      setLiveStats({ distanceMeters: 0, durationSec: 0, avgSpeedKmh: 0, maxSpeedKmh: 0 });
      setActivePlannedRoute(plannedRoute ?? null);
      sentPointCountRef.current = 0;
      setLiveSpeedWarning(false);
      setIsRunModalVisible(true);
    } catch (err: any) {
      showAlert('Xato', err.response?.data?.message || "Yugurishni boshlab bo'lmadi");
    } finally {
      setIsStartingRun(false);
    }
  };

  const finishTracking = async () => {
    const isTaskRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
    if (isTaskRunning) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  };

  const handleStopRun = async () => {
    if (!activeRunId) return;
    setIsFinishingRun(true);
    try {
      await finishTracking();
      const points = await readRunPoints();
      if (points.length < 2) {
        showAlert('Juda qisqa', "Bu yugurishni saqlash uchun yetarli GPS nuqtalari yozilmadi.");
        return;
      }

      // Only the raw path is sent — the server recomputes distance/speed from
      // it itself, since trusting client-submitted numbers directly would
      // make the leaderboard trivially fakeable.
      const res = await getApi().patch(`/runs/${activeRunId}/finish`, { path: points });

      await clearRunBuffer();
      await dismissRunNotification();
      setActiveRunId(null);
      setRunStartedAt(null);
      setLivePoints([]);
      setActivePlannedRoute(null);
      setLiveSpeedWarning(false);
      setIsRunModalVisible(false);

      if (res.data.warning) {
        showAlert('Ajoyib yugurish!', `${(res.data.distanceMeters / 1000).toFixed(2)} km yozib olindi.\n\n${res.data.warning}`);
      } else {
        showAlert('Ajoyib yugurish!', `${(res.data.distanceMeters / 1000).toFixed(2)} km yozib olindi.`);
      }
      if (res.data.banned) {
        showAlert(
          "Hisob to'xtatildi",
          "Hisobingiz takroriy tezlik qoidabuzarliklari uchun to'xtatildi. Agar bu xato deb hisoblasangiz, qo'llab-quvvatlash xizmatiga murojaat qiling.",
        );
      }
      // These two don't depend on each other - firing them together instead
      // of one after the other saves a full network round trip.
      const [, meRes] = await Promise.all([fetchHome(), getApi().get('/auth/me').catch(() => null)]);
      if (meRes) setCurrentUser(meRes.data);
    } catch (err: any) {
      showAlert('Xato', err.response?.data?.message || "Yugurishni saqlab bo'lmadi");
    } finally {
      setIsFinishingRun(false);
    }
  };

  const handleDiscardRun = () => {
    showAlert('Yugurishni bekor qilasizmi?', 'Bu yugurish saqlanmaydi.', [
      { text: "Yo'q", style: 'cancel' },
      {
        text: "Ha, bekor qilish",
        style: 'destructive',
        onPress: async () => {
          try {
            await finishTracking();
            if (activeRunId) {
              // Best-effort: local state is cleared regardless (below) so the
              // user isn't stuck if this fails, but log it - if the server
              // call fails here, that run stays "in_progress" server-side
              // with nothing to ever finish or discard it.
              await getApi()
                .patch(`/runs/${activeRunId}/discard`)
                .catch((err) => console.warn('Failed to discard run server-side:', err?.message));
            }
          } finally {
            await clearRunBuffer();
            await dismissRunNotification();
            setActiveRunId(null);
            setRunStartedAt(null);
            setLivePoints([]);
            setActivePlannedRoute(null);
            setIsRunModalVisible(false);
          }
        },
      },
    ]);
  };

  const isReady = !isInitializing && fontsLoaded;

  useEffect(() => {
    if (isReady) SplashScreen.hideAsync().catch(() => {});
  }, [isReady]);

  if (!isReady) {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="footsteps" size={40} color={colors.accent} />
        <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: space.lg }} />
      </View>
    );
  }

  if (!token || !currentUser) {
    return (
      <View style={styles.loginContainer}>
        <StatusBar barStyle="light-content" />
        {/* Soft off-center glow instead of a flat black canvas - the single
            biggest "someone designed this" signal a login screen can carry
            for free. */}
        <View style={styles.loginGlow} pointerEvents="none" />
        <SafeAreaView style={{ flex: 1 }}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.logoContainer}>
                <LinearGradient colors={[colors.accent, colors.accentDeep]} style={styles.logoBadge}>
                  <Ionicons name="footsteps" size={34} color={colors.onAccent} />
                </LinearGradient>
                <Text style={styles.logoText}>RunApp</Text>
                <Text style={styles.logoSubtext}>
                  {authMode === 'login' ? "Yuguring. Musobaqalashing. G'oling." : 'Hisobingizni yarating'}
                </Text>
              </View>

              <View style={styles.loginCard}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>FOYDALANUVCHI NOMI</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="person-outline" size={18} color={colors.textFaint} style={styles.inputIcon} />
                    <TextInput
                      value={username}
                      onChangeText={setUsername}
                      placeholder="foydalanuvchi nomi"
                      placeholderTextColor={colors.textFaint}
                      style={styles.textInput}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="next"
                    />
                  </View>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>PAROL</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="lock-closed-outline" size={18} color={colors.textFaint} style={styles.inputIcon} />
                    <TextInput
                      value={password}
                      onChangeText={setPassword}
                      placeholder="parolingiz"
                      placeholderTextColor={colors.textFaint}
                      style={styles.textInput}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={handleAuthSubmit}
                    />
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={10}>
                      <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textFaint} />
                    </TouchableOpacity>
                  </View>
                </View>

                <PressableScale onPress={handleAuthSubmit} disabled={isSubmittingAuth} style={{ marginTop: space.sm }}>
                  <LinearGradient colors={[colors.accent, colors.accentDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryButton}>
                    {isSubmittingAuth ? (
                      <ActivityIndicator color={colors.onAccent} />
                    ) : (
                      <Text style={styles.primaryButtonText}>
                        {authMode === 'login' ? 'Kirish' : "Ro'yxatdan o'tish"}
                      </Text>
                    )}
                  </LinearGradient>
                </PressableScale>

                <TouchableOpacity
                  style={styles.authModeToggle}
                  onPress={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
                >
                  <Text style={styles.authModeToggleText}>
                    {authMode === 'login' ? "Yangimisiz? " : 'Hisobingiz bormi? '}
                    <Text style={styles.authModeToggleLink}>
                      {authMode === 'login' ? 'Hisob yarating' : 'Kirish'}
                    </Text>
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.mainContainer} edges={['top']}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        {screen === 'home' ? (
          <View>
            <Text style={styles.headerGreeting}>{greeting()}</Text>
            <Text style={styles.headerTitle}>{currentUser.username}</Text>
          </View>
        ) : (
          <Text style={styles.headerTitle}>
            {screen === 'leaderboard' && 'Reyting'}
            {screen === 'history' && 'Tarix'}
            {screen === 'plan' && 'Yugurish rejalashtirish'}
            {screen === 'profile' && 'Profil'}
          </Text>
        )}
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton} hitSlop={8}>
          <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        </TouchableOpacity>
      </View>

      {currentUser.isBanned && (
        <View style={styles.bannedBanner}>
          <Ionicons name="shield-outline" size={16} color={colors.danger} />
          <Text style={styles.bannedBannerText}>
            {currentUser.bannedReason || "Hisobingiz shubhali tezlik faoliyati uchun to'xtatilgan."} Yangi yugurishlar yuborilishi mumkin emas.
          </Text>
        </View>
      )}

      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={15} color={colors.warning} />
          <Text style={styles.offlineBannerText}>Internet aloqasi yo'q — ma'lumotlar yangilanmayapti</Text>
        </View>
      )}

      <Animated.View style={{ flex: 1, opacity: screenFade }}>
        {screen === 'home' && (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={isLoadingHome && !!stats} onRefresh={fetchHome} tintColor={colors.accent} colors={[colors.accent]} />
            }
          >
            {homeError && (
              <TouchableOpacity onPress={fetchHome} style={styles.inlineRetry}>
                <Ionicons name="refresh-outline" size={14} color={colors.warning} />
                <Text style={styles.inlineRetryText}>Ma&apos;lumotlarni yuklab bo&apos;lmadi. Qayta urinish uchun bosing.</Text>
              </TouchableOpacity>
            )}
            {isLoadingHome && !stats ? (
              <HomeSkeleton width={screenWidth} />
            ) : (
              <>
                <PressableScale
                  onPress={() => handleStartRun()}
                  disabled={isStartingRun || currentUser.isBanned}
                  haptic="medium"
                  style={currentUser.isBanned ? { opacity: 0.4 } : undefined}
                >
                  <LinearGradient
                    colors={[colors.accent, colors.accentDeep]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.startRunButton}
                  >
                    {isStartingRun ? (
                      <ActivityIndicator color={colors.onAccent} />
                    ) : (
                      <>
                        <View style={styles.startRunIconWrap}>
                          <Ionicons name="play" size={20} color={colors.onAccent} />
                        </View>
                        <Text style={styles.startRunButtonText}>Yugurishni boshlash</Text>
                      </>
                    )}
                  </LinearGradient>
                </PressableScale>

                <View style={styles.statsGrid}>
                  <StatCard icon="footsteps-outline" label="Masofa" value={`${formatKm(stats?.totalDistanceM ?? 0)}`} unit="km" width={screenWidth} />
                  <StatCard icon="trophy-outline" label="Ballar" value={`${stats?.totalPoints ?? 0}`} width={screenWidth} tint="amber" />
                  <StatCard icon="speedometer-outline" label="O'rtacha tezlik" value={`${stats?.avgSpeedKmh ?? 0}`} unit="km/h" width={screenWidth} />
                  <StatCard icon="flame-outline" label="Ketma-ketlik" value={`${stats?.currentStreakDays ?? 0}`} unit="kun" width={screenWidth} tint="amber" />
                </View>

                <View style={styles.goalCard}>
                  <View style={styles.goalHeaderRow}>
                    <Text style={styles.goalTitle}>Haftalik maqsad</Text>
                    {isEditingGoal ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <TextInput
                          value={goalInput}
                          onChangeText={setGoalInput}
                          keyboardType="decimal-pad"
                          autoFocus
                          onSubmitEditing={saveWeeklyGoal}
                          onBlur={saveWeeklyGoal}
                          style={styles.goalInput}
                        />
                        <Text style={styles.goalEditUnit}>km</Text>
                      </View>
                    ) : (
                      <TouchableOpacity onPress={() => setIsEditingGoal(true)} hitSlop={6}>
                        <Text style={styles.goalEditLink}>O&apos;zgartirish</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {(() => {
                    const weekKm = (stats?.weekDistanceM ?? 0) / 1000;
                    const pct = Math.max(0, Math.min(100, (weekKm / weeklyGoalKm) * 100));
                    const reached = weekKm >= weeklyGoalKm;
                    return (
                      <>
                        <View style={styles.goalBarTrack}>
                          <LinearGradient
                            colors={reached ? [colors.accent, colors.accent] : [colors.accent, colors.accentDeep]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 0 }}
                            style={[styles.goalBarFill, { width: `${pct}%` }]}
                          />
                        </View>
                        <Text style={styles.goalProgressText}>
                          {weekKm.toFixed(1)} / {weeklyGoalKm} km {reached ? '🎉' : `· ${Math.max(0, weeklyGoalKm - weekKm).toFixed(1)} km qoldi`}
                        </Text>
                      </>
                    );
                  })()}
                </View>

                <WeeklyChart runs={recentRuns} />

                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>So'nggi yugurishlar</Text>
                  <TouchableOpacity onPress={() => switchScreen('history')} hitSlop={6}>
                    <Text style={styles.viewAllLink}>Barchasi</Text>
                  </TouchableOpacity>
                </View>
                {recentRuns.length === 0 ? (
                  <EmptyState
                    icon="footsteps-outline"
                    title="Hali yugurishlar yo'q"
                    subtitle="Birinchi yugurishingizni boshlab, statistikangizni shu yerda kuzating."
                    compact
                  />
                ) : (
                  recentRuns.map((run) => (
                    <PressableScale key={run.id} style={styles.runRow} onPress={() => openRunDetail(run.id)}>
                      <View style={styles.runRowIconWrap}>
                        <Ionicons name="footsteps" size={18} color={colors.accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.runRowDate}>{formatRunDay(run.startedAt)}</Text>
                          {!!run.flaggedSegments && <Ionicons name="warning-outline" size={12} color={colors.warning} />}
                        </View>
                        <Text style={styles.runRowMeta}>
                          {formatKm(run.distanceMeters)} km · {Math.round(run.durationSec / 60)} daq · {run.avgSpeedKmh} km/h
                        </Text>
                      </View>
                      <View style={styles.runRowPointsPill}>
                        <Text style={styles.runRowPoints}>+{run.pointsEarned}</Text>
                      </View>
                    </PressableScale>
                  ))
                )}
              </>
            )}
          </ScrollView>
        )}

        {screen === 'leaderboard' && (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={isLoadingLeaderboard && leaderboard.length > 0}
                onRefresh={fetchLeaderboard}
                tintColor={colors.accent}
                colors={[colors.accent]}
              />
            }
          >
            {leaderboardError && (
              <TouchableOpacity onPress={fetchLeaderboard} style={styles.inlineRetry}>
                <Ionicons name="refresh-outline" size={14} color={colors.warning} />
                <Text style={styles.inlineRetryText}>Ma&apos;lumotlarni yuklab bo&apos;lmadi. Qayta urinish uchun bosing.</Text>
              </TouchableOpacity>
            )}
            <SegmentedControl
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'daily', label: 'Kunlik' },
                { value: 'weekly', label: 'Haftalik' },
                { value: 'alltime', label: 'Barcha vaqt' },
              ]}
            />

            {isLoadingLeaderboard && leaderboard.length === 0 ? (
              <LeaderboardSkeleton />
            ) : leaderboard.length === 0 ? (
              <EmptyState
                icon="trophy-outline"
                title="Bu davrda hali yugurishlar qayd etilmagan"
                subtitle="Birinchi bo'lib yugurib, reytingni boshlang."
              />
            ) : (
              <>
                {/* Podium: top 3 of this period, laid out 2nd-1st-3rd like a
                    real awards stand instead of just a plainer first row. */}
                <View style={styles.podiumRow}>
                  {[leaderboard[1], leaderboard[0], leaderboard[2]].map((entry, idx) => {
                    if (!entry) return <View key={`empty-${idx}`} style={styles.podiumSlot} />;
                    const isFirst = idx === 1;
                    const rankColor = entry.rank === 1 ? colors.gold : entry.rank === 2 ? colors.silver : colors.bronze;
                    return (
                      <View key={entry.userId} style={[styles.podiumSlot, isFirst && styles.podiumSlotFirst]}>
                        <Avatar
                          uri={entry.avatarUrl ? `${SERVER_URL}${entry.avatarUrl}` : null}
                          name={entry.username}
                          size={isFirst ? 60 : 46}
                          ring={entry.userId === currentUser.id}
                        />
                        <View style={[styles.podiumRankBadge, { backgroundColor: rankColor }]}>
                          <Text style={styles.podiumRankText}>{entry.rank}</Text>
                        </View>
                        <Text style={styles.podiumName} numberOfLines={1}>{entry.username}</Text>
                        <Text style={styles.podiumPoints}>{entry.points} ball</Text>
                      </View>
                    );
                  })}
                </View>

                {!myRank.rank && (
                  <Text style={styles.leaderboardNoRankHint}>Siz bu davrda hali yugurmagansiz</Text>
                )}

                {myRank.rank && myRank.entry && !leaderboard.slice(0, 3).some((e) => e.userId === currentUser.id) && (
                  <View style={[styles.leaderboardRow, styles.leaderboardRowMe, { marginBottom: space.md }]}>
                    <Text style={styles.leaderboardRank}>{myRank.rank}</Text>
                    <Avatar uri={myRank.entry.avatarUrl ? `${SERVER_URL}${myRank.entry.avatarUrl}` : null} name={myRank.entry.username} />
                    <View style={{ flex: 1, marginLeft: space.md }}>
                      <Text style={styles.leaderboardUsername}>{myRank.entry.username} (siz)</Text>
                      <Text style={styles.leaderboardDistance}>{(myRank.entry.distanceMeters / 1000).toFixed(2)} km</Text>
                    </View>
                    <Text style={styles.leaderboardPoints}>{myRank.entry.points} ball</Text>
                  </View>
                )}

                {leaderboard.slice(3).map((entry) => (
                  <View
                    key={entry.userId}
                    style={[styles.leaderboardRow, entry.userId === currentUser.id && styles.leaderboardRowMe]}
                  >
                    <Text style={styles.leaderboardRank}>{entry.rank}</Text>
                    <Avatar uri={entry.avatarUrl ? `${SERVER_URL}${entry.avatarUrl}` : null} name={entry.username} />
                    <View style={{ flex: 1, marginLeft: space.md }}>
                      <Text style={styles.leaderboardUsername}>{entry.username}</Text>
                      <Text style={styles.leaderboardDistance}>{(entry.distanceMeters / 1000).toFixed(2)} km</Text>
                    </View>
                    <Text style={styles.leaderboardPoints}>{entry.points} ball</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        )}

        {screen === 'history' && (
          // SectionList instead of a flat FlatList — same virtualization
          // benefit (up to 100 rows used to all mount at once with a plain
          // ScrollView+.map()) but grouped into month headers so a long
          // history reads as "September / August / July…" instead of one
          // undifferentiated scroll.
          <SectionList
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            sections={historySections}
            keyExtractor={(run) => run.id}
            stickySectionHeadersEnabled={false}
            refreshing={isLoadingHistory && historyRuns.length > 0}
            onRefresh={fetchHistory}
            renderSectionHeader={({ section }) => <Text style={styles.historySectionHeader}>{section.title}</Text>}
            ListHeaderComponent={
              historyError ? (
                <TouchableOpacity onPress={fetchHistory} style={styles.inlineRetry}>
                  <Ionicons name="refresh-outline" size={14} color={colors.warning} />
                  <Text style={styles.inlineRetryText}>Ma&apos;lumotlarni yuklab bo&apos;lmadi. Qayta urinish uchun bosing.</Text>
                </TouchableOpacity>
              ) : null
            }
            ListEmptyComponent={
              isLoadingHistory ? (
                <HistorySkeleton />
              ) : (
                <EmptyState icon="time-outline" title="Hali yugurishlar yo'q" subtitle="Yugurishlaringiz shu yerda tarix bo'lib to'planadi." />
              )
            }
            renderItem={({ item: run }) => (
              <PressableScale style={styles.runRow} onPress={() => openRunDetail(run.id)}>
                <View style={styles.runRowIconWrap}>
                  <Ionicons name="footsteps" size={18} color={colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.runRowDate}>{formatRunDay(run.startedAt)}</Text>
                    {!!run.flaggedSegments && <Ionicons name="warning-outline" size={12} color={colors.warning} />}
                  </View>
                  <Text style={styles.runRowMeta}>
                    {formatKm(run.distanceMeters)} km · {Math.round(run.durationSec / 60)} daq · {run.avgSpeedKmh} km/h
                  </Text>
                </View>
                <View style={styles.runRowPointsPill}>
                  <Text style={styles.runRowPoints}>+{run.pointsEarned}</Text>
                </View>
              </PressableScale>
            )}
          />
        )}

        {screen === 'plan' && (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.planIntroRow}>
              <View style={styles.planIntroIconWrap}>
                <Ionicons name="compass-outline" size={18} color={colors.accent} />
              </View>
              <Text style={styles.planIntro}>Masofani tanlang va yaqiningizdan aylanma yo'nalish oling.</Text>
            </View>

            <View style={styles.planDistanceRow}>
              {PLAN_DISTANCES.map((km) => (
                <TouchableOpacity
                  key={km}
                  onPress={() => setPlanTargetKm(km)}
                  style={[styles.planDistanceChip, planTargetKm === km && styles.planDistanceChipActive]}
                >
                  <Text style={[styles.planDistanceChipText, planTargetKm === km && styles.planDistanceChipTextActive]}>
                    {km} km
                  </Text>
                </TouchableOpacity>
              ))}
              {/* +/- stepper instead of a bare numeric keyboard TextInput -
                  a full km distance is almost always chosen in half-km
                  increments anyway, and tapping is faster than typing here. */}
              <View style={styles.planStepperWrapper}>
                <PressableScale
                  onPress={() => setPlanTargetKm((v) => Math.max(0.5, Math.round((v - 0.5) * 2) / 2))}
                  scaleTo={0.85}
                  haptic={false}
                  style={styles.planStepperButton}
                >
                  <Ionicons name="remove" size={16} color={colors.text} />
                </PressableScale>
                <Text style={styles.planStepperValue}>{planTargetKm} km</Text>
                <PressableScale
                  onPress={() => setPlanTargetKm((v) => Math.min(42, Math.round((v + 0.5) * 2) / 2))}
                  scaleTo={0.85}
                  haptic={false}
                  style={styles.planStepperButton}
                >
                  <Ionicons name="add" size={16} color={colors.text} />
                </PressableScale>
              </View>
            </View>

            <PressableScale
              onPress={handleSuggestRoute}
              disabled={isLocatingForPlan || isSuggestingRoute}
              style={{ marginTop: space.lg }}
            >
              <LinearGradient colors={[colors.accent, colors.accentDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryButton}>
                {isLocatingForPlan || isSuggestingRoute ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {suggestedRoute ? "Boshqa yo'nalish taklif qilish" : `Yaqinimdan ${planTargetKm} km yo'nalish taklif qilish`}
                  </Text>
                )}
              </LinearGradient>
            </PressableScale>

            {planError && <Text style={styles.planError}>{planError}</Text>}

            {suggestedRoute && (
              <View style={{ marginTop: space.xl }}>
                <LeafletMap path={suggestedRoute.path} height={280} />
                <View style={styles.statsGrid}>
                  <StatCard icon="footsteps-outline" label="Yo'nalish masofasi" value={(suggestedRoute.distanceMeters / 1000).toFixed(2)} unit="km" width={screenWidth} />
                  <StatCard icon="time-outline" label="Taxminiy yurish vaqti" value={`~${Math.round(suggestedRoute.durationSec / 60)}`} unit="daq" width={screenWidth} tint="amber" />
                </View>
                <PressableScale onPress={() => handleStartRun(suggestedRoute)} disabled={isStartingRun || currentUser.isBanned} style={{ marginTop: space.md }}>
                  <LinearGradient colors={[colors.accent, colors.accentDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryButton}>
                    {isStartingRun ? (
                      <ActivityIndicator color={colors.onAccent} />
                    ) : (
                      <Text style={styles.primaryButtonText}>Shu yo'nalish bo'ylab yugurishni boshlash</Text>
                    )}
                  </LinearGradient>
                </PressableScale>
                <Text style={styles.planHint}>Yozib olish fon rejimida ishlaydi — ekranni qulflab, davom eting.</Text>
              </View>
            )}
          </ScrollView>
        )}

        {screen === 'profile' && (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.profileCard}>
              <TouchableOpacity onPress={handlePickAvatar} style={styles.profileAvatarWrapper}>
                {currentUser.avatarUrl ? (
                  <Image source={{ uri: `${SERVER_URL}${currentUser.avatarUrl}` }} style={styles.profileAvatarImage as any} />
                ) : (
                  <View style={styles.profileAvatarPlaceholder}>
                    <Text style={styles.profileAvatarInitials}>{currentUser.username.slice(0, 2).toUpperCase()}</Text>
                  </View>
                )}
                <View style={styles.profileAvatarOverlay}>
                  {isUploadingAvatar ? <ActivityIndicator color={colors.text} size="small" /> : <Ionicons name="camera-outline" size={18} color={colors.text} />}
                </View>
              </TouchableOpacity>
              <Text style={styles.profileUsernameLabel}>{currentUser.username}</Text>
              <Text style={styles.profileHint}>O'zgartirish uchun rasmingizga bosing</Text>
            </View>

            {!!stats && (
              <View style={styles.profileCard}>
                <Text style={styles.profileSectionTitle}>Rekordlar</Text>
                <View style={styles.recordsRow}>
                  <View style={styles.recordItem}>
                    <Ionicons name="flash" size={18} color={colors.amber} />
                    <Text style={styles.recordValue}>{stats.bestMaxSpeedKmh}</Text>
                    <Text style={styles.recordLabel}>Rekord tezlik, km/h</Text>
                  </View>
                  <View style={styles.recordItem}>
                    <Ionicons name="flame" size={18} color={colors.amber} />
                    <Text style={styles.recordValue}>{stats.longestStreakDays}</Text>
                    <Text style={styles.recordLabel}>Eng uzun ketma-ketlik, kun</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={styles.profileCard}>
              <Text style={styles.profileSectionTitle}>Foydalanuvchi nomi</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="person-outline" size={18} color={colors.textFaint} style={styles.inputIcon} />
                <TextInput
                  value={profileUsername}
                  onChangeText={setProfileUsername}
                  placeholderTextColor={colors.textFaint}
                  style={styles.textInput}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (!isSavingUsername && profileUsername.trim() && profileUsername !== currentUser.username) handleSaveUsername();
                  }}
                />
              </View>
              {(() => {
                const isDisabled = isSavingUsername || !profileUsername.trim() || profileUsername === currentUser.username;
                const label = isSavingUsername ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={[styles.primaryButtonText, isDisabled && styles.primaryButtonTextDisabled]}>Saqlash</Text>
                );
                return (
                  <PressableScale onPress={handleSaveUsername} disabled={isDisabled} style={{ marginTop: space.md }}>
                    {isDisabled ? (
                      <View style={[styles.primaryButton, styles.primaryButtonDisabled]}>{label}</View>
                    ) : (
                      <LinearGradient colors={[colors.accent, colors.accentDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryButton}>
                        {label}
                      </LinearGradient>
                    )}
                  </PressableScale>
                );
              })()}
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileSectionTitle}>Parolni o'zgartirish</Text>
              <View style={[styles.inputWrapper, { marginBottom: 12 }]}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textFaint} style={styles.inputIcon} />
                <TextInput
                  value={currentPasswordInput}
                  onChangeText={setCurrentPasswordInput}
                  placeholder="Joriy parol"
                  placeholderTextColor={colors.textFaint}
                  style={styles.textInput}
                  secureTextEntry
                  autoCapitalize="none"
                  returnKeyType="next"
                  onSubmitEditing={() => newPasswordRef.current?.focus()}
                  blurOnSubmit={false}
                />
              </View>
              <View style={[styles.inputWrapper, { marginBottom: 12 }]}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textFaint} style={styles.inputIcon} />
                <TextInput
                  ref={newPasswordRef}
                  value={newPasswordInput}
                  onChangeText={setNewPasswordInput}
                  placeholder="Yangi parol"
                  placeholderTextColor={colors.textFaint}
                  style={styles.textInput}
                  secureTextEntry
                  autoCapitalize="none"
                  returnKeyType="next"
                  onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                  blurOnSubmit={false}
                />
              </View>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textFaint} style={styles.inputIcon} />
                <TextInput
                  ref={confirmPasswordRef}
                  value={confirmPasswordInput}
                  onChangeText={setConfirmPasswordInput}
                  placeholder="Yangi parolni tasdiqlang"
                  placeholderTextColor={colors.textFaint}
                  style={styles.textInput}
                  secureTextEntry
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (!isSavingPassword && currentPasswordInput && newPasswordInput && confirmPasswordInput) handleChangePassword();
                  }}
                />
              </View>
              {(() => {
                const isDisabled = isSavingPassword || !currentPasswordInput || !newPasswordInput || !confirmPasswordInput;
                const label = isSavingPassword ? (
                  <ActivityIndicator color={colors.onAccent} />
                ) : (
                  <Text style={[styles.primaryButtonText, isDisabled && styles.primaryButtonTextDisabled]}>Parolni yangilash</Text>
                );
                return (
                  <PressableScale onPress={handleChangePassword} disabled={isDisabled} style={{ marginTop: space.md }}>
                    {isDisabled ? (
                      <View style={[styles.primaryButton, styles.primaryButtonDisabled]}>{label}</View>
                    ) : (
                      <LinearGradient colors={[colors.accent, colors.accentDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryButton}>
                        {label}
                      </LinearGradient>
                    )}
                  </PressableScale>
                );
              })()}
            </View>

            <Text style={styles.footerText}>RunApp v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
          </ScrollView>
        )}
      </Animated.View>

      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {(
          [
            { key: 'home', icon: 'home', label: 'Bosh' },
            { key: 'leaderboard', icon: 'trophy', label: 'Reyting' },
            { key: 'history', icon: 'time', label: 'Tarix' },
            { key: 'plan', icon: 'map', label: 'Reja' },
            { key: 'profile', icon: 'person', label: 'Profil' },
          ] as { key: Screen; icon: string; label: string }[]
        ).map((tab) => {
          const isActive = screen === tab.key;
          return (
            <TouchableOpacity key={tab.key} onPress={() => switchScreen(tab.key)} style={styles.tabItem} activeOpacity={0.7}>
              <View style={[styles.tabIconWrap, isActive && styles.tabIconWrapActive]}>
                <Ionicons name={(isActive ? tab.icon : `${tab.icon}-outline`) as any} size={19} color={isActive ? colors.onAccent : colors.textDim} />
              </View>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ACTIVE RUN TRACKING MODAL — full-screen live map with floating blurred controls */}
      <Modal animationType="slide" visible={isRunModalVisible} onRequestClose={() => {}}>
        <View style={styles.liveMapRoot}>
          <StatusBar barStyle="light-content" />
          {(() => {
            const elapsedSec = runStartedAt ? Math.max(0, Math.floor((nowTick - runStartedAt) / 1000)) : 0;
            const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
            const secs = (elapsedSec % 60).toString().padStart(2, '0');
            const mapCenter = livePoints[0] ?? activePlannedRoute?.path[0] ?? null;
            const avatarUrl = currentUser?.avatarUrl ? `${SERVER_URL}${currentUser.avatarUrl}` : null;

            return (
              <>
                {mapCenter ? (
                  <LiveLeafletMap
                    ref={liveMapRef}
                    initialCenter={mapCenter}
                    secondaryPath={activePlannedRoute?.path}
                    avatarUrl={avatarUrl}
                  />
                ) : (
                  <View style={styles.liveMapPlaceholder}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={styles.liveMapPlaceholderText}>GPS kutilmoqda…</Text>
                  </View>
                )}

                <SafeAreaView style={styles.liveOverlayTop} pointerEvents="box-none">
                  <BlurView intensity={70} tint="dark" style={styles.liveHeaderPill}>
                    <PulseDot color={colors.danger} size={8} />
                    <Text style={styles.runModalLiveText}>YOZILMOQDA</Text>
                  </BlurView>
                  {liveSpeedWarning && (
                    <BlurView intensity={70} tint="dark" style={styles.liveWarningPill}>
                      <Ionicons name="warning-outline" size={16} color={colors.warning} />
                      <Text style={styles.runModalWarningText}>Juda tez — bu qism hisoblanmaydi</Text>
                    </BlurView>
                  )}
                </SafeAreaView>

                <SafeAreaView style={styles.liveOverlayBottom} pointerEvents="box-none">
                  <BlurView intensity={80} tint="dark" style={styles.liveStatsPanel}>
                    <Text style={styles.runModalTime}>{mins}:{secs}</Text>
                    <Text style={styles.runModalTimeLabel}>VAQT</Text>
                    <View style={styles.runModalStatsRow}>
                      <View style={styles.runModalStat}>
                        <Text style={styles.runModalStatValue}>{(liveStats.distanceMeters / 1000).toFixed(2)}</Text>
                        <Text style={styles.runModalStatLabel}>KM</Text>
                      </View>
                      <View style={styles.runModalStatDivider} />
                      <View style={styles.runModalStat}>
                        <Text style={styles.runModalStatValue}>{liveStats.avgSpeedKmh || 0}</Text>
                        <Text style={styles.runModalStatLabel}>O'RT KM/S</Text>
                      </View>
                      <View style={styles.runModalStatDivider} />
                      <View style={styles.runModalStat}>
                        <Text style={styles.runModalStatValue}>{liveStats.maxSpeedKmh || 0}</Text>
                        <Text style={styles.runModalStatLabel}>MAKS KM/S</Text>
                      </View>
                    </View>
                  </BlurView>

                  <View style={styles.runModalActions}>
                    <PressableScale onPress={handleDiscardRun} disabled={isFinishingRun} haptic="medium" style={styles.runModalDiscardButton}>
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                      <Text style={styles.runModalDiscardText}>Bekor qilish</Text>
                    </PressableScale>
                    <PressableScale onPress={handleStopRun} disabled={isFinishingRun} haptic="medium" style={{ flex: 1 }}>
                      <LinearGradient colors={[colors.accent, colors.accentDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.runModalStopButton}>
                        {isFinishingRun ? <ActivityIndicator color={colors.onAccent} /> : (
                          <>
                            <Ionicons name="stop-circle" size={24} color={colors.onAccent} />
                            <Text style={styles.runModalStopText}>To'xtatish va saqlash</Text>
                          </>
                        )}
                      </LinearGradient>
                    </PressableScale>
                  </View>
                </SafeAreaView>
              </>
            );
          })()}
        </View>
      </Modal>

      {/* RUN DETAIL MODAL */}
      <Modal animationType="slide" visible={isLoadingRunDetail || !!selectedRun} onRequestClose={() => setSelectedRun(null)}>
        <SafeAreaView style={styles.runModalContainer}>
          <StatusBar barStyle="light-content" />
          <View style={styles.runModalHeader}>
            <TouchableOpacity onPress={() => setSelectedRun(null)} style={{ position: 'absolute', left: 0 }} hitSlop={10}>
              <Ionicons name="chevron-down" size={26} color={colors.textDim} />
            </TouchableOpacity>
            <Text style={styles.runModalLiveTextNeutral}>YUGURISH TAFSILOTI</Text>
            {!!selectedRun && (
              <TouchableOpacity
                onPress={() => {
                  Share.share({
                    message: `Men ${formatKm(selectedRun.distanceMeters)} km yugurdim, ${Math.round(selectedRun.durationSec / 60)} daqiqada (${selectedRun.avgSpeedKmh} km/h o'rtacha tezlik) va ${selectedRun.pointsEarned} ball to'pladim! 🏃 RunApp orqali.`,
                  }).catch(() => {});
                }}
                style={{ position: 'absolute', right: 0 }}
                hitSlop={10}
              >
                <Ionicons name="share-outline" size={22} color={colors.textDim} />
              </TouchableOpacity>
            )}
          </View>

          {isLoadingRunDetail || !selectedRun ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
          ) : (
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={styles.detailDate}>
                {new Date(selectedRun.startedAt).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })}
              </Text>

              {selectedRun.flaggedSegments > 0 && (
                <View style={[styles.runModalWarning, { marginTop: 12, marginBottom: 4 }]}>
                  <Ionicons name="warning-outline" size={16} color={colors.warning} />
                  <Text style={styles.runModalWarningText}>
                    Bu yugurishning {selectedRun.flaggedSegments} qismi yugurish uchun juda tez bo&apos;lgani uchun hisoblanmadi.
                  </Text>
                </View>
              )}

              {selectedRun.path.length > 1 ? (
                <View style={{ marginTop: 16 }}>
                  <LeafletMap path={selectedRun.path} secondaryPath={selectedRun.plannedRoutePath ?? undefined} height={280} />
                  {!!selectedRun.plannedRoutePath?.length && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 16, height: 2, backgroundColor: colors.accent, borderRadius: 2 }} />
                        <Text style={styles.legendText}>Haqiqiy</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 16, height: 2, backgroundColor: colors.textDim, borderRadius: 2 }} />
                        <Text style={styles.legendText}>Rejalashtirilgan</Text>
                      </View>
                      {selectedRun.plannedDistanceMeters != null && (
                        <Text style={[styles.legendText, { marginLeft: 'auto' }]}>
                          Reja {(selectedRun.plannedDistanceMeters / 1000).toFixed(2)} km
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              ) : (
                <EmptyState icon="map-outline" title="Bu yugurish uchun yo'nalish ma'lumoti yo'q" compact />
              )}

              <View style={[styles.statsGrid, { marginTop: 20 }]}>
                <StatCard icon="footsteps-outline" label="Masofa" value={formatKm(selectedRun.distanceMeters)} unit="km" width={screenWidth} />
                <StatCard
                  icon="time-outline"
                  label="Davomiyligi"
                  value={`${Math.floor(selectedRun.durationSec / 60)}:${(selectedRun.durationSec % 60).toString().padStart(2, '0')}`}
                  width={screenWidth}
                />
                <StatCard icon="speedometer-outline" label="O'rtacha tezlik" value={`${selectedRun.avgSpeedKmh}`} unit="km/h" width={screenWidth} />
                <StatCard icon="flash-outline" label="Maksimal tezlik" value={`${selectedRun.maxSpeedKmh}`} unit="km/h" width={screenWidth} tint="amber" />
              </View>

              <LinearGradient colors={[colors.accentSoft, 'transparent']} style={[styles.profileCard, { marginTop: 16, alignItems: 'flex-start' }]}>
                <View style={styles.pointsEarnedRow}>
                  <View style={styles.pointsEarnedIconWrap}>
                    <Ionicons name="trophy" size={18} color={colors.onAccent} />
                  </View>
                  <View>
                    <Text style={styles.pointsEarnedValue}>+{selectedRun.pointsEarned}</Text>
                    <Text style={styles.pointsEarnedLabel}>TO'PLANGAN BALLAR</Text>
                  </View>
                </View>
              </LinearGradient>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

// Memoized since AppInner re-renders as a whole on every 2s live-run poll
// tick - these otherwise re-render right along with it even though their
// own props rarely change.
const StatCard = React.memo(function StatCard({
  icon,
  label,
  value,
  unit,
  width,
  tint = 'green',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  unit?: string;
  width: number;
  /** 'amber' for point/streak-flavored stats so the grid isn't monochrome. */
  tint?: 'green' | 'amber';
}) {
  const cardWidth = (Math.min(width, 600) - space.xl * 2 - space.md) / 2;
  const tintColor = tint === 'amber' ? colors.amber : colors.accent;
  const tintSoft = tint === 'amber' ? colors.amberSoft : colors.accentSoft;
  return (
    <View style={[styles.statCard, { width: cardWidth }]}>
      <View style={[styles.statCardIconWrap, { backgroundColor: tintSoft }]}>
        <Ionicons name={icon} size={16} color={tintColor} />
      </View>
      <View style={styles.statCardValueRow}>
        <Text style={styles.statCardValue}>{value}</Text>
        {!!unit && <Text style={styles.statCardUnit}> {unit}</Text>}
      </View>
      <Text style={styles.statCardLabel}>{label}</Text>
    </View>
  );
});

// Last-7-days distance bars built entirely client-side from the runs Home
// already fetched (`/runs/me?limit=6`) — no backend endpoint for this
// exists, and none is needed for a lightweight glance at the week's shape.
// Caveat: if more than 6 runs happened in the window this undercounts,
// since only the 6 most recent are ever in memory - acceptable for a quick
// visual, not a source of truth (the real weekly total still comes from
// `stats.weekDistanceM` above).
const WeeklyChart = React.memo(function WeeklyChart({ runs }: { runs: Run[] }) {
  const days = React.useMemo(() => {
    const today = new Date();
    const out: { label: string; km: number; isToday: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const km = runs.filter((r) => new Date(r.startedAt).toDateString() === d.toDateString()).reduce((sum, r) => sum + r.distanceMeters, 0) / 1000;
      out.push({ label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), km, isToday: i === 0 });
    }
    return out;
  }, [runs]);
  const maxKm = Math.max(1, ...days.map((d) => d.km));

  return (
    <View style={styles.weeklyChartCard}>
      <Text style={styles.weeklyChartTitle}>So&apos;nggi 7 kun</Text>
      <View style={styles.weeklyChartRow}>
        {days.map((d, idx) => (
          <View key={idx} style={styles.weeklyChartColumn}>
            <View style={styles.weeklyChartTrack}>
              {d.km > 0 && (
                <View style={[styles.weeklyChartBar, d.isToday && styles.weeklyChartBarToday, { height: `${Math.max(8, (d.km / maxKm) * 100)}%` }]} />
              )}
            </View>
            <Text style={[styles.weeklyChartLabel, d.isToday && styles.weeklyChartLabelToday]}>{d.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
});

function HomeSkeleton({ width }: { width: number }) {
  const cardWidth = (Math.min(width, 600) - space.xl * 2 - space.md) / 2;
  return (
    <View>
      <SkeletonBlock height={56} radius={radius.lg} style={{ marginBottom: space.xl }} />
      <View style={styles.statsGrid}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBlock key={i} width={cardWidth} height={92} radius={radius.lg} style={{ marginBottom: space.md }} />
        ))}
      </View>
      <SkeletonBlock height={92} radius={radius.lg} style={{ marginTop: space.md, marginBottom: space.xl }} />
      {[0, 1, 2].map((i) => (
        <SkeletonBlock key={i} height={64} radius={radius.lg} style={{ marginBottom: space.sm }} />
      ))}
    </View>
  );
}

function LeaderboardSkeleton() {
  return (
    <View style={{ marginTop: space.xl }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.md, marginBottom: space.xl }}>
        <SkeletonBlock width={70} height={110} radius={radius.lg} />
        <SkeletonBlock width={70} height={130} radius={radius.lg} />
        <SkeletonBlock width={70} height={100} radius={radius.lg} />
      </View>
      {[0, 1, 2, 3].map((i) => (
        <SkeletonBlock key={i} height={60} radius={radius.lg} style={{ marginBottom: space.sm }} />
      ))}
    </View>
  );
}

function HistorySkeleton() {
  return (
    <View style={{ marginTop: space.md }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <SkeletonBlock key={i} height={64} radius={radius.lg} style={{ marginBottom: space.sm }} />
      ))}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
      <AppAlertHost />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: colors.bg0, alignItems: 'center', justifyContent: 'center' },
  loginContainer: { flex: 1, backgroundColor: colors.bg0 },
  // A big soft-edged accent circle bleeding off the top corner - the
  // cheapest possible way to make a plain dark screen feel lit rather than
  // flat. Purely decorative, pointerEvents disabled.
  loginGlow: {
    position: 'absolute',
    top: -180,
    right: -120,
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: colors.accentSoft,
  },
  loginScroll: { flexGrow: 1, justifyContent: 'center', padding: space.xl },
  loginCard: {
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: space.xl,
  },
  logoContainer: { alignItems: 'center', marginBottom: space.xxl },
  logoBadge: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
    shadowColor: colors.accentDeep,
  },
  logoText: { fontSize: 30, lineHeight: 38, fontFamily: font.display, color: colors.text, marginTop: space.md, letterSpacing: 0.2 },
  logoSubtext: { fontSize: 12.5, color: colors.textDim, marginTop: 6, fontFamily: font.bodySemi, textTransform: 'uppercase', letterSpacing: 1 },
  inputGroup: { marginBottom: space.lg },
  inputLabel: { fontSize: 10.5, fontFamily: font.bodyExtraBold, color: colors.textDim, marginBottom: space.sm, letterSpacing: 1.4 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md + 2,
  },
  inputIcon: { marginRight: space.sm + 2 },
  textInput: { flex: 1, height: 50, color: colors.text, fontSize: 14.5, fontFamily: font.bodyMedium },
  primaryButton: {
    height: 54,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: colors.onAccent, fontSize: 15, fontFamily: font.bodyBold },
  // Was `{ opacity: 0.5 }` on the whole button - fading BOTH the green
  // background and the black text toward the dark app background crushed
  // the text-vs-background contrast down to almost nothing (confirmed
  // on-device: the label was barely legible). A dedicated muted style
  // keeps the disabled state clearly readable instead.
  primaryButtonDisabled: { backgroundColor: colors.bg1, borderWidth: 1, borderColor: colors.border },
  primaryButtonTextDisabled: { color: colors.textDim },
  authModeToggle: { marginTop: space.xl, alignItems: 'center' },
  authModeToggleText: { color: colors.textDim, fontSize: 13, fontFamily: font.bodyMedium },
  authModeToggleLink: { color: colors.accent, fontFamily: font.bodyBold },
  mainContainer: { flex: 1, backgroundColor: colors.bg0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingVertical: space.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg1,
  },
  headerGreeting: { fontSize: 12.5, lineHeight: 16, color: colors.textDim, fontFamily: font.bodySemi, marginBottom: 2 },
  headerTitle: { flex: 1, fontSize: 22, lineHeight: 28, fontFamily: font.display, color: colors.text, letterSpacing: 0.2 },
  logoutButton: { padding: space.sm, backgroundColor: colors.bg1, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  scrollContent: { padding: space.xl, paddingBottom: space.xxxl },
  inlineRetry: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm + 2 },
  inlineRetryText: { color: colors.warning, fontSize: 12.5, fontFamily: font.bodySemi, flexShrink: 1 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: space.xl },
  statCard: {
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  statCardIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statCardValueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: space.sm + 2 },
  statCardValue: { color: colors.text, fontSize: 19, lineHeight: 24, fontFamily: font.display },
  statCardUnit: { color: colors.textDim, fontSize: 12, fontFamily: font.bodySemi },
  statCardLabel: { color: colors.textDim, fontSize: 11.5, marginTop: 2, fontFamily: font.bodyMedium },
  startRunButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    height: 66,
    marginBottom: space.xl,
    ...shadow.raised,
    shadowColor: colors.accentDeep,
  },
  startRunIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(4,20,13,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  startRunButtonText: { color: colors.onAccent, fontSize: 17, fontFamily: font.bodyExtraBold },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  sectionTitle: { color: colors.text, fontSize: 15.5, fontFamily: font.bodyBold },
  emptyText: { color: colors.textDim, fontSize: 13, fontFamily: font.bodyMedium },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md + 2,
    marginBottom: space.sm,
  },
  runRowIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  runRowDate: { color: colors.text, fontSize: 13.5, fontFamily: font.bodyBold },
  runRowMeta: { color: colors.textDim, fontSize: 11.5, marginTop: 2, fontFamily: font.bodyMedium },
  runRowPointsPill: { backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingHorizontal: space.sm + 2, paddingVertical: 4 },
  runRowPoints: { color: colors.accent, fontFamily: font.bodyExtraBold, fontSize: 12.5 },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  leaderboardRowMe: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  leaderboardRank: { width: 22, textAlign: 'center', color: colors.textDim, fontFamily: font.bodyExtraBold, fontSize: 13 },
  leaderboardUsername: { color: colors.text, fontSize: 13.5, fontFamily: font.bodySemi },
  leaderboardDistance: { color: colors.textDim, fontSize: 11.5, marginTop: 1, fontFamily: font.bodyMedium },
  leaderboardPoints: { color: colors.accent, fontFamily: font.bodyExtraBold, fontSize: 13 },
  leaderboardNoRankHint: { color: colors.textFaint, fontSize: 12, fontFamily: font.bodyMedium, textAlign: 'center', marginBottom: space.md },
  podiumRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.sm, marginBottom: space.xl },
  podiumSlot: { flex: 1, alignItems: 'center', backgroundColor: colors.bg1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: space.lg, paddingHorizontal: space.xs },
  podiumSlotFirst: { paddingVertical: space.xl, backgroundColor: colors.bg2, borderColor: colors.borderStrong },
  podiumRankBadge: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: -11, borderWidth: 2, borderColor: colors.bg1 },
  podiumRankText: { color: colors.onAccent, fontSize: 11, fontFamily: font.bodyExtraBold },
  podiumName: { color: colors.text, fontSize: 12, fontFamily: font.bodySemi, marginTop: space.sm, maxWidth: 84 },
  podiumPoints: { color: colors.textDim, fontSize: 11, fontFamily: font.bodyMedium, marginTop: 1 },
  profileCard: {
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    padding: space.xl,
    marginBottom: space.lg,
    alignItems: 'center',
  },
  profileAvatarWrapper: {
    width: 88,
    height: 88,
    borderRadius: 44,
    marginBottom: space.md,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 2,
    borderColor: colors.accent,
  },
  profileAvatarImage: { width: '100%', height: '100%' },
  profileAvatarPlaceholder: { width: '100%', height: '100%', backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  profileAvatarInitials: { color: colors.accent, fontSize: 26, lineHeight: 32, fontFamily: font.display },
  profileAvatarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Opaque enough that the camera hint reads cleanly on its own - at
    // ~0.45 the initials underneath showed through and collided visually
    // with the icon (confirmed on-device).
    backgroundColor: 'rgba(10,11,14,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileUsernameLabel: { color: colors.text, fontSize: 17, lineHeight: 22, fontFamily: font.display },
  profileHint: { color: colors.textDim, fontSize: 11.5, marginTop: 4, textAlign: 'center', fontFamily: font.bodyMedium },
  profileSectionTitle: { color: colors.text, fontSize: 14, fontFamily: font.bodyBold, alignSelf: 'flex-start', marginBottom: space.md },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.bg1,
    backgroundColor: colors.bg0,
    paddingTop: space.sm + 2,
    paddingHorizontal: 4,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 3 },
  tabIconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  tabIconWrapActive: { backgroundColor: colors.accent },
  tabLabel: { color: colors.textDim, fontSize: 10, fontFamily: font.bodySemi },
  tabLabelActive: { color: colors.text },
  runModalContainer: { flex: 1, backgroundColor: colors.bg0, justifyContent: 'space-between', padding: space.xl + 4 },
  runModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, marginTop: space.md },
  runModalLiveText: { color: colors.danger, fontSize: 12, fontFamily: font.bodyExtraBold, letterSpacing: 2 },
  runModalWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.warningSoft,
    borderWidth: 1,
    borderColor: 'rgba(240,180,41,0.3)',
    borderRadius: radius.md,
    padding: space.sm + 2,
    marginTop: space.lg,
  },
  runModalWarningText: { color: colors.warning, fontSize: 11, fontFamily: font.bodySemi, flexShrink: 1, textAlign: 'center' },
  runModalTime: { color: colors.text, fontSize: 64, lineHeight: 78, fontFamily: font.display, fontVariant: ['tabular-nums'] },
  runModalTimeLabel: { color: colors.textDim, fontSize: 12, fontFamily: font.bodyExtraBold, letterSpacing: 2, marginTop: 4 },
  runModalStatsRow: { flexDirection: 'row', alignItems: 'center', gap: space.xxl, marginTop: space.xxxl + 8 },
  runModalStat: { alignItems: 'center' },
  runModalStatDivider: { width: 1, height: 28, backgroundColor: colors.border },
  runModalStatValue: { color: colors.accent, fontSize: 26, lineHeight: 32, fontFamily: font.display },
  runModalStatLabel: { color: colors.textDim, fontSize: 10.5, fontFamily: font.bodyExtraBold, letterSpacing: 1, marginTop: 4 },
  runModalActions: { flexDirection: 'row', gap: space.md, marginBottom: space.md },
  runModalDiscardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.lg,
    height: 60,
    width: 116,
    backgroundColor: 'rgba(10,11,14,0.6)',
  },
  runModalDiscardText: { color: colors.danger, fontSize: 13, fontFamily: font.bodyBold },
  runModalStopButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    height: 60,
  },
  runModalStopText: { color: colors.onAccent, fontSize: 16, fontFamily: font.bodyExtraBold },
  liveMapRoot: { flex: 1, backgroundColor: colors.bg0 },
  liveMapPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  liveMapPlaceholderText: { color: colors.textDim, fontSize: 13, fontFamily: font.bodySemi },
  liveOverlayTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: space.md,
    gap: space.sm,
  },
  liveHeaderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  liveWarningPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
    borderRadius: radius.lg,
    marginHorizontal: space.xl,
    overflow: 'hidden',
  },
  liveOverlayBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
    gap: space.lg,
  },
  liveStatsPanel: {
    borderRadius: radius.xl + 2,
    paddingVertical: space.xl + 4,
    alignItems: 'center',
    overflow: 'hidden',
  },
  runModalLiveTextNeutral: { color: colors.textDim, fontSize: 12, fontFamily: font.bodyExtraBold, letterSpacing: 2 },
  detailDate: { color: colors.text, fontSize: 20, lineHeight: 26, fontFamily: font.display },
  legendText: { color: colors.textDim, fontSize: 11, fontFamily: font.bodyMedium },
  pointsEarnedRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pointsEarnedIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  pointsEarnedValue: { color: colors.accent, fontSize: 26, lineHeight: 32, fontFamily: font.display },
  pointsEarnedLabel: { color: colors.textDim, fontSize: 10.5, fontFamily: font.bodyExtraBold, letterSpacing: 1, marginTop: 2 },
  bannedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.dangerSoft,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(240,87,107,0.2)',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm + 2,
  },
  bannedBannerText: { color: colors.danger, fontSize: 11, flex: 1, lineHeight: 15, fontFamily: font.bodyMedium },
  viewAllLink: { color: colors.accent, fontSize: 12.5, fontFamily: font.bodyBold },
  planIntroRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xl },
  planIntroIconWrap: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  planIntro: { flex: 1, color: colors.textDim, fontSize: 13, lineHeight: 18, fontFamily: font.bodyMedium },
  planDistanceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  planDistanceChip: {
    paddingHorizontal: space.lg + 2,
    paddingVertical: space.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  planDistanceChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  planDistanceChipText: { color: colors.textDim, fontSize: 13, fontFamily: font.bodyBold },
  planDistanceChipTextActive: { color: colors.onAccent },
  planStepperWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  planStepperButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planStepperValue: { color: colors.text, fontFamily: font.bodyBold, fontSize: 13.5, minWidth: 48, textAlign: 'center' },
  planError: { color: colors.danger, fontSize: 12, textAlign: 'center', marginTop: space.md, fontFamily: font.bodyMedium },
  planHint: { color: colors.textDim, fontSize: 11, textAlign: 'center', marginTop: space.md, lineHeight: 16, fontFamily: font.bodyMedium },
  goalCard: {
    backgroundColor: colors.bg1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginTop: space.lg,
  },
  goalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.md },
  goalTitle: { color: colors.text, fontSize: 14, fontFamily: font.bodyBold },
  goalEditLink: { color: colors.accent, fontSize: 12, fontFamily: font.bodyBold },
  goalInput: {
    color: colors.text,
    fontFamily: font.bodyBold,
    fontSize: 14,
    minWidth: 36,
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
  },
  goalEditUnit: { color: colors.textDim, fontSize: 12, fontFamily: font.bodyMedium },
  goalBarTrack: { height: 10, borderRadius: 5, backgroundColor: colors.bg2, overflow: 'hidden' },
  goalBarFill: { height: '100%', borderRadius: 5 },
  goalProgressText: { color: colors.textDim, fontSize: 12, fontFamily: font.bodyMedium, marginTop: space.sm },
  weeklyChartCard: {
    backgroundColor: colors.bg1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginTop: space.lg,
    marginBottom: space.xl,
  },
  weeklyChartTitle: { color: colors.text, fontSize: 14, fontFamily: font.bodyBold, marginBottom: space.lg },
  weeklyChartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 84 },
  weeklyChartColumn: { flex: 1, alignItems: 'center', gap: space.xs },
  weeklyChartTrack: { width: 18, flex: 1, borderRadius: 9, backgroundColor: colors.bg2, justifyContent: 'flex-end', overflow: 'hidden' },
  weeklyChartBar: { width: '100%', borderRadius: 9, backgroundColor: colors.accent },
  weeklyChartBarToday: { backgroundColor: colors.amber },
  weeklyChartLabel: { color: colors.textFaint, fontSize: 10, fontFamily: font.bodyMedium },
  weeklyChartLabelToday: { color: colors.text, fontFamily: font.bodyBold },
  historySectionHeader: {
    color: colors.textDim,
    fontSize: 12,
    fontFamily: font.bodyExtraBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    backgroundColor: colors.warningSoft,
  },
  offlineBannerText: { color: colors.warning, fontSize: 11.5, flex: 1, fontFamily: font.bodyMedium },
  recordsRow: { flexDirection: 'row', gap: space.md },
  recordItem: { flex: 1, alignItems: 'center', backgroundColor: colors.bg2, borderRadius: radius.md, paddingVertical: space.lg, gap: space.xs },
  recordValue: { color: colors.text, fontSize: 18, fontFamily: font.displaySemi, lineHeight: 22 },
  recordLabel: { color: colors.textDim, fontSize: 11, fontFamily: font.bodyMedium },
  footerText: { color: colors.textFaint, fontSize: 11.5, textAlign: 'center', marginTop: space.xl, marginBottom: space.md, fontFamily: font.bodyMedium },
});
