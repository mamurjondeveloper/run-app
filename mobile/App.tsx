import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  Modal,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import axios from 'axios';
import {
  LOCATION_TASK_NAME,
  ACTIVE_RUN_ID_KEY,
  ACTIVE_RUN_STARTED_AT_KEY,
  readRunPoints,
  clearRunBuffer,
  computeRunStats,
  RunPoint,
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

const SERVER_URL = 'https://api-run.xisd.uz';

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

  const [period, setPeriod] = useState<Period>('daily');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [myRank, setMyRank] = useState<{ rank: number | null; entry: LeaderboardEntry | null }>({ rank: null, entry: null });

  const [historyRuns, setHistoryRuns] = useState<Run[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [isLoadingRunDetail, setIsLoadingRunDetail] = useState(false);

  const [planTargetKm, setPlanTargetKm] = useState(5);
  const [manualPlanKmInput, setManualPlanKmInput] = useState('5');
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
  const [activePlannedRoute, setActivePlannedRoute] = useState<SuggestedRoute | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [isFinishingRun, setIsFinishingRun] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveMapRef = useRef<LiveLeafletMapHandle>(null);
  const sentPointCountRef = useRef(0);
  const lastNotifUpdateRef = useRef(0);

  const getApi = useCallback(() => {
    return axios.create({
      baseURL: SERVER_URL,
      headers: { Authorization: token ? `Bearer ${token}` : '' },
    });
  }, [token]);

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedToken = await SecureStore.getItemAsync('runapp_jwt_token');
        if (savedToken) {
          setToken(savedToken);
          axios
            .get(`${SERVER_URL}/auth/me`, { headers: { Authorization: `Bearer ${savedToken}` } })
            .then((res) => setCurrentUser(res.data))
            .catch(() => {});
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
        const liveStats = computeRunStats(points);
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
    try {
      const [statsRes, runsRes] = await Promise.all([
        getApi().get('/auth/stats'),
        getApi().get('/runs/me?limit=6'),
      ]);
      setStats(statsRes.data);
      setRecentRuns(runsRes.data);
      refreshDailyRecapNotification(statsRes.data);
    } catch {
      // Non-critical
    } finally {
      setIsLoadingHome(false);
    }
  }, [token, getApi]);

  useEffect(() => {
    if (token && screen === 'home') fetchHome();
  }, [token, screen, fetchHome]);

  const fetchLeaderboard = useCallback(async () => {
    if (!token) return;
    setIsLoadingLeaderboard(true);
    try {
      const [boardRes, meRes] = await Promise.all([
        getApi().get(`/leaderboard?period=${period}`),
        getApi().get(`/leaderboard/me?period=${period}`),
      ]);
      setLeaderboard(boardRes.data);
      setMyRank(meRes.data);
    } catch {
      // Non-critical
    } finally {
      setIsLoadingLeaderboard(false);
    }
  }, [token, getApi, period]);

  useEffect(() => {
    if (token && screen === 'leaderboard') fetchLeaderboard();
  }, [token, screen, period, fetchLeaderboard]);

  const fetchHistory = useCallback(async () => {
    if (!token) return;
    setIsLoadingHistory(true);
    try {
      const res = await getApi().get('/runs/me?limit=200');
      setHistoryRuns(res.data);
    } catch {
      // Non-critical
    } finally {
      setIsLoadingHistory(false);
    }
  }, [token, getApi]);

  useEffect(() => {
    if (token && screen === 'history') fetchHistory();
  }, [token, screen, fetchHistory]);

  const openRunDetail = async (runId: string) => {
    setIsLoadingRunDetail(true);
    setSelectedRun(null);
    try {
      const res = await getApi().get(`/runs/${runId}`);
      setSelectedRun(res.data);
    } catch {
      Alert.alert('Xato', "Bu yugurishni yuklab bo'lmadi");
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
      Alert.alert('Xato', "Barcha maydonlarni to'ldiring");
      return;
    }
    setIsSubmittingAuth(true);
    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const res = await axios.post(`${SERVER_URL}${endpoint}`, { username, password });
      const jwtToken = res.data.access_token;
      await SecureStore.setItemAsync('runapp_jwt_token', jwtToken);
      await AsyncStorage.setItem('runapp_server_url', SERVER_URL);
      setToken(jwtToken);
      setCurrentUser(res.data.user);
      setScreen('home');
    } catch (err: any) {
      const msg = err.response?.data?.message || `${authMode === 'login' ? 'Kirishda' : "Ro'yxatdan o'tishda"} xatolik yuz berdi.`;
      Alert.alert('Xato', Array.isArray(msg) ? msg.join('\n') : msg);
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

  const handlePickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Ruxsat kerak', "Profil rasmini o'zgartirish uchun galereyaga ruxsat bering.");
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
      Alert.alert('Xato', err.response?.data?.message || "Rasmni yuklab bo'lmadi");
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
      Alert.alert('Saqlandi', 'Foydalanuvchi nomi yangilandi!');
    } catch (err: any) {
      Alert.alert('Xato', err.response?.data?.message || "Foydalanuvchi nomini yangilab bo'lmadi");
    } finally {
      setIsSavingUsername(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPasswordInput !== confirmPasswordInput) {
      Alert.alert('Xato', 'Yangi parollar mos kelmadi');
      return;
    }
    setIsSavingPassword(true);
    try {
      await getApi().post('/auth/change-password', {
        currentPassword: currentPasswordInput,
        newPassword: newPasswordInput,
      });
      Alert.alert('Muvaffaqiyatli', "Parol muvaffaqiyatli o'zgartirildi!");
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
    } catch (err: any) {
      Alert.alert('Xato', err.response?.data?.message || "Parolni o'zgartirib bo'lmadi");
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleStartRun = async (plannedRoute?: SuggestedRoute) => {
    setIsStartingRun(true);
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== 'granted') {
        Alert.alert('Ruxsat kerak', 'Yugurishni kuzatish uchun joylashuvga ruxsat kerak.');
        return;
      }

      const existingBackground = await Location.getBackgroundPermissionsAsync();
      if (existingBackground.status !== 'granted') {
        // Android 11+ won't grant "Allow all the time" from a simple popup - it
        // sends the user into system Settings instead. Explain that up front
        // so it doesn't look like the app just crashed/kicked them out.
        await new Promise<void>((resolve) => {
          Alert.alert(
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
          notificationColor: '#22c55e',
        },
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
      });

      setActiveRunId(runId);
      setRunStartedAt(startedAt);
      setLivePoints([]);
      setActivePlannedRoute(plannedRoute ?? null);
      sentPointCountRef.current = 0;
      setLiveSpeedWarning(false);
      setIsRunModalVisible(true);
    } catch (err: any) {
      Alert.alert('Xato', err.response?.data?.message || "Yugurishni boshlab bo'lmadi");
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
        Alert.alert('Juda qisqa', "Bu yugurishni saqlash uchun yetarli GPS nuqtalari yozilmadi.");
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
        Alert.alert('Ajoyib yugurish!', `${(res.data.distanceMeters / 1000).toFixed(2)} km yozib olindi.\n\n${res.data.warning}`);
      } else {
        Alert.alert('Ajoyib yugurish!', `${(res.data.distanceMeters / 1000).toFixed(2)} km yozib olindi.`);
      }
      if (res.data.banned) {
        Alert.alert(
          "Hisob to'xtatildi",
          "Hisobingiz takroriy tezlik qoidabuzarliklari uchun to'xtatildi. Agar bu xato deb hisoblasangiz, qo'llab-quvvatlash xizmatiga murojaat qiling.",
        );
      }
      fetchHome();
      const meRes = await getApi().get('/auth/me').catch(() => null);
      if (meRes) setCurrentUser(meRes.data);
    } catch (err: any) {
      Alert.alert('Xato', err.response?.data?.message || "Yugurishni saqlab bo'lmadi");
    } finally {
      setIsFinishingRun(false);
    }
  };

  const handleDiscardRun = () => {
    Alert.alert('Yugurishni bekor qilasizmi?', 'Bu yugurish saqlanmaydi.', [
      { text: "Yo'q", style: 'cancel' },
      {
        text: "Ha, bekor qilish",
        style: 'destructive',
        onPress: async () => {
          try {
            await finishTracking();
            if (activeRunId) {
              await getApi().patch(`/runs/${activeRunId}/discard`).catch(() => {});
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

  if (isInitializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#22c55e" />
      </View>
    );
  }

  if (!token || !currentUser) {
    return (
      <SafeAreaView style={styles.loginContainer}>
        <StatusBar barStyle="light-content" />
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.loginCard}>
              <View style={styles.logoContainer}>
                <Ionicons name="footsteps" size={54} color="#22c55e" />
                <Text style={styles.logoText}>RunApp</Text>
                <Text style={styles.logoSubtext}>
                  {authMode === 'login' ? "Yuguring. Musobaqalashing. G'oling." : 'Hisobingizni yarating'}
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>FOYDALANUVCHI NOMI</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="person-outline" size={18} color="#71717a" style={styles.inputIcon} />
                  <TextInput
                    value={username}
                    onChangeText={setUsername}
                    placeholder="foydalanuvchi nomi"
                    placeholderTextColor="#52525b"
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
                  <Ionicons name="lock-closed-outline" size={18} color="#71717a" style={styles.inputIcon} />
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                    placeholderTextColor="#52525b"
                    style={styles.textInput}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={handleAuthSubmit}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={10}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color="#71717a" />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity style={styles.primaryButton} onPress={handleAuthSubmit} disabled={isSubmittingAuth}>
                {isSubmittingAuth ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {authMode === 'login' ? 'Kirish' : "Ro'yxatdan o'tish"}
                  </Text>
                )}
              </TouchableOpacity>

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
    );
  }

  return (
    <SafeAreaView style={styles.mainContainer} edges={['top']}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {screen === 'home' && 'RunApp'}
          {screen === 'leaderboard' && 'Reyting'}
          {screen === 'history' && 'Tarix'}
          {screen === 'plan' && 'Yugurish rejalashtirish'}
          {screen === 'profile' && 'Profil'}
        </Text>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Ionicons name="log-out-outline" size={16} color="#ef4444" />
        </TouchableOpacity>
      </View>

      {currentUser.isBanned && (
        <View style={styles.bannedBanner}>
          <Ionicons name="shield-outline" size={16} color="#ef4444" />
          <Text style={styles.bannedBannerText}>
            {currentUser.bannedReason || "Hisobingiz shubhali tezlik faoliyati uchun to'xtatilgan."} Yangi yugurishlar yuborilishi mumkin emas.
          </Text>
        </View>
      )}

      <View style={{ flex: 1 }}>
        {screen === 'home' && (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {isLoadingHome && !stats ? (
              <ActivityIndicator color="#22c55e" style={{ marginTop: 40 }} />
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.startRunButton, currentUser.isBanned && { opacity: 0.4 }]}
                  onPress={() => handleStartRun()}
                  disabled={isStartingRun || currentUser.isBanned}
                >
                  {isStartingRun ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Ionicons name="play-circle" size={26} color="#000" />
                      <Text style={styles.startRunButtonText}>Yugurishni boshlash</Text>
                    </>
                  )}
                </TouchableOpacity>

                <View style={styles.statsGrid}>
                  <StatCard icon="footsteps-outline" label="Masofa" value={`${formatKm(stats?.totalDistanceM ?? 0)} km`} width={screenWidth} />
                  <StatCard icon="trophy-outline" label="Ballar" value={`${stats?.totalPoints ?? 0}`} width={screenWidth} />
                  <StatCard icon="speedometer-outline" label="O'rtacha tezlik" value={`${stats?.avgSpeedKmh ?? 0} km/h`} width={screenWidth} />
                  <StatCard icon="flame-outline" label="Ketma-ketlik" value={`${stats?.currentStreakDays ?? 0}k`} width={screenWidth} />
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>So'nggi yugurishlar</Text>
                  <TouchableOpacity onPress={() => setScreen('history')}>
                    <Text style={styles.viewAllLink}>Barchasini ko'rish</Text>
                  </TouchableOpacity>
                </View>
                {recentRuns.length === 0 ? (
                  <Text style={styles.emptyText}>Hali yugurishlar yo'q</Text>
                ) : (
                  recentRuns.map((run) => (
                    <TouchableOpacity key={run.id} style={styles.runRow} onPress={() => openRunDetail(run.id)}>
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.runRowDate}>
                            {new Date(run.startedAt).toLocaleDateString()}
                          </Text>
                          {!!run.flaggedSegments && <Ionicons name="warning-outline" size={12} color="#f59e0b" />}
                        </View>
                        <Text style={styles.runRowMeta}>
                          {formatKm(run.distanceMeters)} km · {Math.round(run.durationSec / 60)} daq · {run.avgSpeedKmh} km/h
                        </Text>
                      </View>
                      <Text style={styles.runRowPoints}>+{run.pointsEarned} ball</Text>
                    </TouchableOpacity>
                  ))
                )}
              </>
            )}
          </ScrollView>
        )}

        {screen === 'leaderboard' && (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.periodTabs}>
              {(['daily', 'weekly', 'alltime'] as Period[]).map((p) => (
                <TouchableOpacity
                  key={p}
                  onPress={() => setPeriod(p)}
                  style={[styles.periodTab, period === p && styles.periodTabActive]}
                >
                  <Text style={[styles.periodTabText, period === p && styles.periodTabTextActive]}>
                    {p === 'daily' ? 'Kunlik' : p === 'weekly' ? 'Haftalik' : 'Barcha vaqt'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {!isLoadingLeaderboard && myRank.rank && myRank.entry && !leaderboard.some((e) => e.userId === currentUser.id) && (
              <View style={[styles.leaderboardRow, styles.leaderboardRowMe, { marginBottom: 16 }]}>
                <Text style={styles.leaderboardRank}>{myRank.rank}</Text>
                <View style={styles.leaderboardAvatar}>
                  {myRank.entry.avatarUrl ? (
                    <Image source={{ uri: `${SERVER_URL}${myRank.entry.avatarUrl}` }} style={styles.leaderboardAvatarImg as any} />
                  ) : (
                    <Text style={styles.leaderboardAvatarInitials}>{myRank.entry.username.slice(0, 2).toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.leaderboardUsername}>{myRank.entry.username} (siz)</Text>
                  <Text style={styles.leaderboardDistance}>{(myRank.entry.distanceMeters / 1000).toFixed(2)} km</Text>
                </View>
                <Text style={styles.leaderboardPoints}>{myRank.entry.points} ball</Text>
              </View>
            )}
            {!isLoadingLeaderboard && !myRank.rank && (
              <Text style={[styles.emptyText, { marginBottom: 12 }]}>Siz bu davrda hali yugurmagansiz</Text>
            )}

            {isLoadingLeaderboard ? (
              <ActivityIndicator color="#22c55e" style={{ marginTop: 24 }} />
            ) : leaderboard.length === 0 ? (
              <Text style={[styles.emptyText, { marginTop: 16 }]}>Bu davrda hali yugurishlar qayd etilmagan</Text>
            ) : (
              leaderboard.map((entry) => (
                <View
                  key={entry.userId}
                  style={[
                    styles.leaderboardRow,
                    entry.userId === currentUser.id && styles.leaderboardRowMe,
                  ]}
                >
                  <Text style={styles.leaderboardRank}>{entry.rank}</Text>
                  <View style={styles.leaderboardAvatar}>
                    {entry.avatarUrl ? (
                      <Image source={{ uri: `${SERVER_URL}${entry.avatarUrl}` }} style={styles.leaderboardAvatarImg as any} />
                    ) : (
                      <Text style={styles.leaderboardAvatarInitials}>{entry.username.slice(0, 2).toUpperCase()}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.leaderboardUsername}>{entry.username}</Text>
                    <Text style={styles.leaderboardDistance}>{(entry.distanceMeters / 1000).toFixed(2)} km</Text>
                  </View>
                  <Text style={styles.leaderboardPoints}>{entry.points} ball</Text>
                </View>
              ))
            )}
          </ScrollView>
        )}

        {screen === 'history' && (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {isLoadingHistory ? (
              <ActivityIndicator color="#22c55e" style={{ marginTop: 24 }} />
            ) : historyRuns.length === 0 ? (
              <Text style={styles.emptyText}>Hali yugurishlar yo'q</Text>
            ) : (
              historyRuns.map((run) => (
                <TouchableOpacity key={run.id} style={styles.runRow} onPress={() => openRunDetail(run.id)}>
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.runRowDate}>{new Date(run.startedAt).toLocaleDateString()}</Text>
                      {!!run.flaggedSegments && <Ionicons name="warning-outline" size={12} color="#f59e0b" />}
                    </View>
                    <Text style={styles.runRowMeta}>
                      {formatKm(run.distanceMeters)} km · {Math.round(run.durationSec / 60)} daq · {run.avgSpeedKmh} km/h
                    </Text>
                  </View>
                  <Text style={styles.runRowPoints}>+{run.pointsEarned} ball</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        )}

        {screen === 'plan' && (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.planIntro}>Masofani tanlang va yaqiningizdan aylanma yo'nalish oling.</Text>

            <View style={styles.planDistanceRow}>
              {PLAN_DISTANCES.map((km) => (
                <TouchableOpacity
                  key={km}
                  onPress={() => {
                    setPlanTargetKm(km);
                    setManualPlanKmInput(String(km));
                  }}
                  style={[styles.planDistanceChip, planTargetKm === km && styles.planDistanceChipActive]}
                >
                  <Text style={[styles.planDistanceChipText, planTargetKm === km && styles.planDistanceChipTextActive]}>
                    {km} km
                  </Text>
                </TouchableOpacity>
              ))}
              <View style={styles.planManualKmWrapper}>
                <TextInput
                  value={manualPlanKmInput}
                  onChangeText={(text) => {
                    setManualPlanKmInput(text);
                    const parsed = parseFloat(text);
                    if (!Number.isNaN(parsed) && parsed >= 0.5 && parsed <= 42) {
                      setPlanTargetKm(parsed);
                    }
                  }}
                  keyboardType="decimal-pad"
                  style={styles.planManualKmInput}
                />
                <Text style={styles.planManualKmLabel}>km</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, { marginTop: 16 }]}
              onPress={handleSuggestRoute}
              disabled={isLocatingForPlan || isSuggestingRoute}
            >
              {isLocatingForPlan || isSuggestingRoute ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {suggestedRoute ? "Boshqa yo'nalish taklif qilish" : `Yaqinimdan ${planTargetKm} km yo'nalish taklif qilish`}
                </Text>
              )}
            </TouchableOpacity>

            {planError && <Text style={styles.planError}>{planError}</Text>}

            {suggestedRoute && (
              <View style={{ marginTop: 20 }}>
                <LeafletMap path={suggestedRoute.path} height={280} />
                <View style={styles.statsGrid}>
                  <StatCard icon="footsteps-outline" label="Yo'nalish masofasi" value={`${(suggestedRoute.distanceMeters / 1000).toFixed(2)} km`} width={screenWidth} />
                  <StatCard icon="time-outline" label="Taxminiy yurish vaqti" value={`~${Math.round(suggestedRoute.durationSec / 60)} daq`} width={screenWidth} />
                </View>
                <TouchableOpacity
                  style={[styles.primaryButton, { marginTop: 14 }]}
                  onPress={() => handleStartRun(suggestedRoute)}
                  disabled={isStartingRun || currentUser.isBanned}
                >
                  {isStartingRun ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Shu yo'nalish bo'ylab yugurishni boshlash</Text>
                  )}
                </TouchableOpacity>
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
                  {isUploadingAvatar ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="camera-outline" size={18} color="#fff" />}
                </View>
              </TouchableOpacity>
              <Text style={styles.profileUsernameLabel}>{currentUser.username}</Text>
              <Text style={styles.profileHint}>O'zgartirish uchun rasmingizga bosing</Text>
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileSectionTitle}>Foydalanuvchi nomi</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="person-outline" size={18} color="#71717a" style={styles.inputIcon} />
                <TextInput
                  value={profileUsername}
                  onChangeText={setProfileUsername}
                  placeholderTextColor="#52525b"
                  style={styles.textInput}
                  autoCapitalize="none"
                />
              </View>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { marginTop: 14 },
                  (!profileUsername.trim() || profileUsername === currentUser.username) && { opacity: 0.5 },
                ]}
                onPress={handleSaveUsername}
                disabled={isSavingUsername || !profileUsername.trim() || profileUsername === currentUser.username}
              >
                {isSavingUsername ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryButtonText}>Saqlash</Text>}
              </TouchableOpacity>
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileSectionTitle}>Parolni o'zgartirish</Text>
              <View style={[styles.inputWrapper, { marginBottom: 12 }]}>
                <Ionicons name="lock-closed-outline" size={18} color="#71717a" style={styles.inputIcon} />
                <TextInput
                  value={currentPasswordInput}
                  onChangeText={setCurrentPasswordInput}
                  placeholder="Joriy parol"
                  placeholderTextColor="#52525b"
                  style={styles.textInput}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>
              <View style={[styles.inputWrapper, { marginBottom: 12 }]}>
                <Ionicons name="lock-closed-outline" size={18} color="#71717a" style={styles.inputIcon} />
                <TextInput
                  value={newPasswordInput}
                  onChangeText={setNewPasswordInput}
                  placeholder="Yangi parol"
                  placeholderTextColor="#52525b"
                  style={styles.textInput}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color="#71717a" style={styles.inputIcon} />
                <TextInput
                  value={confirmPasswordInput}
                  onChangeText={setConfirmPasswordInput}
                  placeholder="Yangi parolni tasdiqlang"
                  placeholderTextColor="#52525b"
                  style={styles.textInput}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>
              <TouchableOpacity
                style={[
                  styles.primaryButton,
                  { marginTop: 14 },
                  (!currentPasswordInput || !newPasswordInput || !confirmPasswordInput) && { opacity: 0.5 },
                ]}
                onPress={handleChangePassword}
                disabled={isSavingPassword || !currentPasswordInput || !newPasswordInput || !confirmPasswordInput}
              >
                {isSavingPassword ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryButtonText}>Parolni yangilash</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>

      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TouchableOpacity onPress={() => setScreen('home')} style={styles.tabItem}>
          <Ionicons name={screen === 'home' ? 'home' : 'home-outline'} size={20} color={screen === 'home' ? '#22c55e' : '#71717a'} />
          <Text style={[styles.tabLabel, screen === 'home' && { color: '#22c55e' }]}>Bosh</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setScreen('leaderboard')} style={styles.tabItem}>
          <Ionicons name={screen === 'leaderboard' ? 'trophy' : 'trophy-outline'} size={20} color={screen === 'leaderboard' ? '#22c55e' : '#71717a'} />
          <Text style={[styles.tabLabel, screen === 'leaderboard' && { color: '#22c55e' }]}>Reyting</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setScreen('history')} style={styles.tabItem}>
          <Ionicons name={screen === 'history' ? 'time' : 'time-outline'} size={20} color={screen === 'history' ? '#22c55e' : '#71717a'} />
          <Text style={[styles.tabLabel, screen === 'history' && { color: '#22c55e' }]}>Tarix</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setScreen('plan')} style={styles.tabItem}>
          <Ionicons name={screen === 'plan' ? 'map' : 'map-outline'} size={20} color={screen === 'plan' ? '#22c55e' : '#71717a'} />
          <Text style={[styles.tabLabel, screen === 'plan' && { color: '#22c55e' }]}>Reja</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setScreen('profile')} style={styles.tabItem}>
          <Ionicons name={screen === 'profile' ? 'person' : 'person-outline'} size={20} color={screen === 'profile' ? '#22c55e' : '#71717a'} />
          <Text style={[styles.tabLabel, screen === 'profile' && { color: '#22c55e' }]}>Profil</Text>
        </TouchableOpacity>
      </View>

      {/* ACTIVE RUN TRACKING MODAL — full-screen live map with floating blurred controls */}
      <Modal animationType="slide" visible={isRunModalVisible} onRequestClose={() => {}}>
        <View style={styles.liveMapRoot}>
          <StatusBar barStyle="light-content" />
          {(() => {
            const liveStats = computeRunStats(livePoints);
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
                    <ActivityIndicator color="#22c55e" />
                    <Text style={styles.liveMapPlaceholderText}>GPS kutilmoqda…</Text>
                  </View>
                )}

                <SafeAreaView style={styles.liveOverlayTop} pointerEvents="box-none">
                  <BlurView intensity={70} tint="dark" style={styles.liveHeaderPill}>
                    <View style={styles.runModalLiveDot} />
                    <Text style={styles.runModalLiveText}>YOZILMOQDA</Text>
                  </BlurView>
                  {liveSpeedWarning && (
                    <BlurView intensity={70} tint="dark" style={styles.liveWarningPill}>
                      <Ionicons name="warning-outline" size={16} color="#f59e0b" />
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
                      <View style={styles.runModalStat}>
                        <Text style={styles.runModalStatValue}>{liveStats.avgSpeedKmh || 0}</Text>
                        <Text style={styles.runModalStatLabel}>O'RT KM/S</Text>
                      </View>
                      <View style={styles.runModalStat}>
                        <Text style={styles.runModalStatValue}>{liveStats.maxSpeedKmh || 0}</Text>
                        <Text style={styles.runModalStatLabel}>MAKS KM/S</Text>
                      </View>
                    </View>
                  </BlurView>

                  <View style={styles.runModalActions}>
                    <TouchableOpacity onPress={handleDiscardRun} style={styles.runModalDiscardButton} disabled={isFinishingRun}>
                      <Ionicons name="trash-outline" size={20} color="#ef4444" />
                      <Text style={styles.runModalDiscardText}>Bekor qilish</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleStopRun} style={styles.runModalStopButton} disabled={isFinishingRun}>
                      {isFinishingRun ? <ActivityIndicator color="#000" /> : (
                        <>
                          <Ionicons name="stop-circle" size={24} color="#000" />
                          <Text style={styles.runModalStopText}>To'xtatish va saqlash</Text>
                        </>
                      )}
                    </TouchableOpacity>
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
            <TouchableOpacity onPress={() => setSelectedRun(null)} style={{ position: 'absolute', left: 0 }}>
              <Ionicons name="chevron-down" size={26} color="#71717a" />
            </TouchableOpacity>
            <Text style={styles.runModalLiveTextNeutral}>YUGURISH TAFSILOTI</Text>
          </View>

          {isLoadingRunDetail || !selectedRun ? (
            <ActivityIndicator color="#22c55e" style={{ marginTop: 40 }} />
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
                  <Ionicons name="warning-outline" size={16} color="#f59e0b" />
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
                        <View style={{ width: 16, height: 2, backgroundColor: '#22c55e', borderRadius: 2 }} />
                        <Text style={{ color: '#71717a', fontSize: 11 }}>Haqiqiy</Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={{ width: 16, height: 2, backgroundColor: '#71717a', borderRadius: 2 }} />
                        <Text style={{ color: '#71717a', fontSize: 11 }}>Rejalashtirilgan</Text>
                      </View>
                      {selectedRun.plannedDistanceMeters != null && (
                        <Text style={{ color: '#71717a', fontSize: 11, marginLeft: 'auto' }}>
                          Reja {(selectedRun.plannedDistanceMeters / 1000).toFixed(2)} km
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              ) : (
                <Text style={[styles.emptyText, { marginTop: 16 }]}>Bu yugurish uchun yo'nalish ma'lumoti yo'q</Text>
              )}

              <View style={[styles.statsGrid, { marginTop: 20 }]}>
                <StatCard icon="footsteps-outline" label="Masofa" value={`${formatKm(selectedRun.distanceMeters)} km`} width={screenWidth} />
                <StatCard
                  icon="time-outline"
                  label="Davomiyligi"
                  value={`${Math.floor(selectedRun.durationSec / 60)}:${(selectedRun.durationSec % 60).toString().padStart(2, '0')}`}
                  width={screenWidth}
                />
                <StatCard icon="speedometer-outline" label="O'rtacha tezlik" value={`${selectedRun.avgSpeedKmh} km/h`} width={screenWidth} />
                <StatCard icon="flash-outline" label="Maksimal tezlik" value={`${selectedRun.maxSpeedKmh} km/h`} width={screenWidth} />
              </View>

              <View style={[styles.profileCard, { marginTop: 16 }]}>
                <Text style={{ color: '#22c55e', fontSize: 28, fontWeight: '900' }}>+{selectedRun.pointsEarned}</Text>
                <Text style={{ color: '#71717a', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, marginTop: 4 }}>
                  TO'PLANGAN BALLAR
                </Text>
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function StatCard({ icon, label, value, width }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; width: number }) {
  const cardWidth = (Math.min(width, 600) - 20 * 2 - 12) / 2;
  return (
    <View style={[styles.statCard, { width: cardWidth }]}>
      <Ionicons name={icon} size={20} color="#22c55e" />
      <Text style={styles.statCardValue}>{value}</Text>
      <Text style={styles.statCardLabel}>{label}</Text>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, backgroundColor: '#09090b', alignItems: 'center', justifyContent: 'center' },
  loginContainer: { flex: 1, backgroundColor: '#09090b' },
  loginScroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  loginCard: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 24,
    padding: 24,
  },
  logoContainer: { alignItems: 'center', marginBottom: 32 },
  logoText: { fontSize: 28, fontWeight: '900', color: '#fff', marginTop: 12, letterSpacing: 0.5 },
  logoSubtext: { fontSize: 12, color: '#71717a', marginTop: 4, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  inputGroup: { marginBottom: 20 },
  inputLabel: { fontSize: 10, fontWeight: 'bold', color: '#a1a1aa', marginBottom: 8, letterSpacing: 1.5 },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#09090b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  textInput: { flex: 1, height: 48, color: '#fff', fontSize: 14 },
  primaryButton: {
    backgroundColor: '#22c55e',
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  primaryButtonText: { color: '#000', fontSize: 15, fontWeight: 'bold' },
  authModeToggle: { marginTop: 20, alignItems: 'center' },
  authModeToggleText: { color: '#71717a', fontSize: 13 },
  authModeToggleLink: { color: '#22c55e', fontWeight: 'bold' },
  mainContainer: { flex: 1, backgroundColor: '#09090b' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#18181b',
  },
  headerTitle: { flex: 1, fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  logoutButton: { padding: 8, backgroundColor: '#18181b', borderRadius: 10, borderWidth: 1, borderColor: '#27272a' },
  scrollContent: { padding: 20, paddingBottom: 40 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  statCard: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 16,
    padding: 14,
  },
  statCardValue: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 8 },
  statCardLabel: { color: '#71717a', fontSize: 11, marginTop: 2 },
  startRunButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#22c55e',
    borderRadius: 20,
    height: 64,
    marginBottom: 20,
  },
  startRunButtonText: { color: '#000', fontSize: 18, fontWeight: '900' },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  emptyText: { color: '#71717a', fontSize: 13, fontStyle: 'italic' },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  runRowDate: { color: '#fff', fontSize: 13, fontWeight: '600' },
  runRowMeta: { color: '#71717a', fontSize: 11, marginTop: 2 },
  runRowPoints: { color: '#22c55e', fontWeight: 'bold', fontSize: 13 },
  periodTabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodTab: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a' },
  periodTabActive: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  periodTabText: { color: '#71717a', fontSize: 12, fontWeight: 'bold' },
  periodTabTextActive: { color: '#000' },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  leaderboardRowMe: { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.08)' },
  leaderboardRank: { width: 20, textAlign: 'center', color: '#71717a', fontWeight: 'bold', fontSize: 13 },
  leaderboardAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(34,197,94,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  leaderboardAvatarImg: { width: '100%', height: '100%' },
  leaderboardAvatarInitials: { color: '#22c55e', fontSize: 12, fontWeight: 'bold' },
  leaderboardUsername: { color: '#fff', fontSize: 13, fontWeight: '600' },
  leaderboardDistance: { color: '#71717a', fontSize: 11, marginTop: 1 },
  leaderboardPoints: { color: '#22c55e', fontWeight: 'bold', fontSize: 13 },
  profileCard: {
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  profileAvatarWrapper: { width: 84, height: 84, borderRadius: 42, marginBottom: 12, overflow: 'hidden', position: 'relative' },
  profileAvatarImage: { width: '100%', height: '100%' },
  profileAvatarPlaceholder: { width: '100%', height: '100%', backgroundColor: 'rgba(34,197,94,0.15)', alignItems: 'center', justifyContent: 'center' },
  profileAvatarInitials: { color: '#22c55e', fontSize: 26, fontWeight: '900' },
  profileAvatarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileUsernameLabel: { color: '#fff', fontSize: 16, fontWeight: '900' },
  profileHint: { color: '#71717a', fontSize: 11, marginTop: 4, textAlign: 'center' },
  profileSectionTitle: { color: '#fff', fontSize: 14, fontWeight: 'bold', alignSelf: 'flex-start', marginBottom: 12 },
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#18181b',
    backgroundColor: '#09090b',
    paddingTop: 10,
    paddingHorizontal: 4,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 4 },
  tabLabel: { color: '#71717a', fontSize: 10, fontWeight: '600' },
  runModalContainer: { flex: 1, backgroundColor: '#09090b', justifyContent: 'space-between', padding: 24 },
  runModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },
  runModalLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  runModalLiveText: { color: '#ef4444', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  runModalWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.3)',
    borderRadius: 14,
    padding: 10,
    marginTop: 16,
  },
  runModalWarningText: { color: '#f59e0b', fontSize: 11, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  runModalTime: { color: '#fff', fontSize: 64, fontWeight: '900', fontVariant: ['tabular-nums'] },
  runModalTimeLabel: { color: '#71717a', fontSize: 12, fontWeight: 'bold', letterSpacing: 2, marginTop: 4 },
  runModalStatsRow: { flexDirection: 'row', gap: 32, marginTop: 48 },
  runModalStat: { alignItems: 'center' },
  runModalStatValue: { color: '#22c55e', fontSize: 28, fontWeight: '900' },
  runModalStatLabel: { color: '#71717a', fontSize: 11, fontWeight: 'bold', letterSpacing: 1, marginTop: 4 },
  runModalActions: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  runModalDiscardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 18,
    height: 60,
    width: 110,
    backgroundColor: 'rgba(9,9,11,0.6)',
  },
  runModalDiscardText: { color: '#ef4444', fontSize: 13, fontWeight: 'bold' },
  runModalStopButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#22c55e',
    borderRadius: 18,
    height: 60,
  },
  runModalStopText: { color: '#000', fontSize: 16, fontWeight: '900' },
  liveMapRoot: { flex: 1, backgroundColor: '#09090b' },
  liveMapPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  liveMapPlaceholderText: { color: '#71717a', fontSize: 13, fontWeight: '600' },
  liveOverlayTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingTop: 12,
    gap: 8,
  },
  liveHeaderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
  },
  liveWarningPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    marginHorizontal: 20,
    overflow: 'hidden',
  },
  liveOverlayBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 16,
  },
  liveStatsPanel: {
    borderRadius: 28,
    paddingVertical: 24,
    alignItems: 'center',
    overflow: 'hidden',
  },
  runModalLiveTextNeutral: { color: '#71717a', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  detailDate: { color: '#fff', fontSize: 20, fontWeight: '900' },
  bannedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(239,68,68,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bannedBannerText: { color: '#ef4444', fontSize: 11, flex: 1, lineHeight: 15 },
  viewAllLink: { color: '#22c55e', fontSize: 12, fontWeight: 'bold' },
  planIntro: { color: '#a1a1aa', fontSize: 13, marginBottom: 20, lineHeight: 18 },
  planDistanceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  planDistanceChip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  planDistanceChipActive: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  planDistanceChipText: { color: '#71717a', fontSize: 13, fontWeight: 'bold' },
  planDistanceChipTextActive: { color: '#000' },
  planManualKmWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  planManualKmInput: { color: '#fff', fontWeight: '700', fontSize: 14, minWidth: 32, padding: 0 },
  planManualKmLabel: { color: '#71717a', fontSize: 12 },
  planError: { color: '#ef4444', fontSize: 12, textAlign: 'center', marginTop: 12 },
  planHint: { color: '#71717a', fontSize: 11, textAlign: 'center', marginTop: 12, lineHeight: 16 },
});
