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

const SERVER_URL = 'https://api-run.xisd.uz';

interface UserInfo {
  id: string;
  username: string;
  avatarUrl: string | null;
}

interface Stats {
  totalDistanceM: number;
  totalRuns: number;
  totalPoints: number;
  bestMaxSpeedKmh: number;
  currentStreakDays: number;
  longestStreakDays: number;
  avgSpeedKmh: number;
}

interface Run {
  id: string;
  startedAt: string;
  distanceMeters: number;
  durationSec: number;
  avgSpeedKmh: number;
  pointsEarned: number;
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
type Screen = 'home' | 'leaderboard' | 'profile';

function formatKm(meters: number) {
  return (meters / 1000).toFixed(2);
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
  const [nowTick, setNowTick] = useState(Date.now());
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [isFinishingRun, setIsFinishingRun] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      const res = await getApi().get(`/leaderboard?period=${period}`);
      setLeaderboard(res.data);
    } catch {
      // Non-critical
    } finally {
      setIsLoadingLeaderboard(false);
    }
  }, [token, getApi, period]);

  useEffect(() => {
    if (token && screen === 'leaderboard') fetchLeaderboard();
  }, [token, screen, period, fetchLeaderboard]);

  useEffect(() => {
    if (screen === 'profile') {
      setProfileUsername(currentUser?.username || '');
    }
  }, [screen, currentUser?.username]);

  const handleAuthSubmit = async () => {
    if (!username || !password) {
      Alert.alert('Error', 'Please fill in all fields');
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
      const msg = err.response?.data?.message || `${authMode === 'login' ? 'Login' : 'Registration'} failed.`;
      Alert.alert('Error', Array.isArray(msg) ? msg.join('\n') : msg);
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
      Alert.alert('Permission needed', 'Please allow photo library access to change your avatar.');
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
      Alert.alert('Error', err.response?.data?.message || 'Failed to upload photo');
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
      Alert.alert('Saved', 'Username updated!');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update username');
    } finally {
      setIsSavingUsername(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPasswordInput !== confirmPasswordInput) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }
    setIsSavingPassword(true);
    try {
      await getApi().post('/auth/change-password', {
        currentPassword: currentPasswordInput,
        newPassword: newPasswordInput,
      });
      Alert.alert('Success', 'Password changed successfully!');
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to change password');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleStartRun = async () => {
    setIsStartingRun(true);
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== 'granted') {
        Alert.alert('Permission needed', 'Location access is required to track your run.');
        return;
      }
      const background = await Location.requestBackgroundPermissionsAsync();
      if (background.status !== 'granted') {
        Alert.alert(
          'Background location needed',
          'Please allow "Allow all the time" location access so your run keeps recording when your screen locks.',
        );
        return;
      }

      const res = await getApi().post('/runs/start');
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
          notificationBody: 'Recording your run…',
          notificationColor: '#22c55e',
        },
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
      });

      setActiveRunId(runId);
      setRunStartedAt(startedAt);
      setLivePoints([]);
      setIsRunModalVisible(true);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to start run');
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
      const runStats = computeRunStats(points);

      await getApi().patch(`/runs/${activeRunId}/finish`, {
        ...runStats,
        path: points,
      });

      await clearRunBuffer();
      setActiveRunId(null);
      setRunStartedAt(null);
      setLivePoints([]);
      setIsRunModalVisible(false);
      Alert.alert('Nice run!', `${(runStats.distanceMeters / 1000).toFixed(2)} km recorded.`);
      fetchHome();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to save run');
    } finally {
      setIsFinishingRun(false);
    }
  };

  const handleDiscardRun = () => {
    Alert.alert('Discard run?', 'This run will not be saved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          try {
            await finishTracking();
            if (activeRunId) {
              await getApi().patch(`/runs/${activeRunId}/discard`).catch(() => {});
            }
          } finally {
            await clearRunBuffer();
            setActiveRunId(null);
            setRunStartedAt(null);
            setLivePoints([]);
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
                  {authMode === 'login' ? 'Run. Compete. Win.' : 'Create Your Account'}
                </Text>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>USERNAME</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="person-outline" size={18} color="#71717a" style={styles.inputIcon} />
                  <TextInput
                    value={username}
                    onChangeText={setUsername}
                    placeholder="username"
                    placeholderTextColor="#52525b"
                    style={styles.textInput}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="next"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>PASSWORD</Text>
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
                    {authMode === 'login' ? 'Sign In' : 'Create Account'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.authModeToggle}
                onPress={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              >
                <Text style={styles.authModeToggleText}>
                  {authMode === 'login' ? "New here? " : 'Already have an account? '}
                  <Text style={styles.authModeToggleLink}>
                    {authMode === 'login' ? 'Create an account' : 'Sign in'}
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
          {screen === 'leaderboard' && 'Leaderboard'}
          {screen === 'profile' && 'Profile'}
        </Text>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Ionicons name="log-out-outline" size={16} color="#ef4444" />
        </TouchableOpacity>
      </View>

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
                  style={styles.startRunButton}
                  onPress={handleStartRun}
                  disabled={isStartingRun}
                >
                  {isStartingRun ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Ionicons name="play-circle" size={26} color="#000" />
                      <Text style={styles.startRunButtonText}>Start Run</Text>
                    </>
                  )}
                </TouchableOpacity>

                <View style={styles.statsGrid}>
                  <StatCard icon="footsteps-outline" label="Distance" value={`${formatKm(stats?.totalDistanceM ?? 0)} km`} width={screenWidth} />
                  <StatCard icon="trophy-outline" label="Points" value={`${stats?.totalPoints ?? 0}`} width={screenWidth} />
                  <StatCard icon="speedometer-outline" label="Avg Speed" value={`${stats?.avgSpeedKmh ?? 0} km/h`} width={screenWidth} />
                  <StatCard icon="flame-outline" label="Streak" value={`${stats?.currentStreakDays ?? 0}d`} width={screenWidth} />
                </View>

                <Text style={styles.sectionTitle}>Recent Runs</Text>
                {recentRuns.length === 0 ? (
                  <Text style={styles.emptyText}>No runs yet</Text>
                ) : (
                  recentRuns.map((run) => (
                    <View key={run.id} style={styles.runRow}>
                      <View>
                        <Text style={styles.runRowDate}>
                          {new Date(run.startedAt).toLocaleDateString()}
                        </Text>
                        <Text style={styles.runRowMeta}>
                          {formatKm(run.distanceMeters)} km · {Math.round(run.durationSec / 60)} min · {run.avgSpeedKmh} km/h
                        </Text>
                      </View>
                      <Text style={styles.runRowPoints}>+{run.pointsEarned} pts</Text>
                    </View>
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
                    {p === 'daily' ? 'Daily' : p === 'weekly' ? 'Weekly' : 'All-time'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {isLoadingLeaderboard ? (
              <ActivityIndicator color="#22c55e" style={{ marginTop: 24 }} />
            ) : leaderboard.length === 0 ? (
              <Text style={[styles.emptyText, { marginTop: 16 }]}>No runs recorded in this period yet</Text>
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
                  <Text style={styles.leaderboardPoints}>{entry.points} pts</Text>
                </View>
              ))
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
              <Text style={styles.profileHint}>Tap your photo to change it</Text>
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileSectionTitle}>Username</Text>
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
                {isSavingUsername ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryButtonText}>Save Username</Text>}
              </TouchableOpacity>
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileSectionTitle}>Change Password</Text>
              <View style={[styles.inputWrapper, { marginBottom: 12 }]}>
                <Ionicons name="lock-closed-outline" size={18} color="#71717a" style={styles.inputIcon} />
                <TextInput
                  value={currentPasswordInput}
                  onChangeText={setCurrentPasswordInput}
                  placeholder="Current password"
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
                  placeholder="New password"
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
                  placeholder="Confirm new password"
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
                {isSavingPassword ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryButtonText}>Update Password</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        )}
      </View>

      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TouchableOpacity onPress={() => setScreen('home')} style={styles.tabItem}>
          <Ionicons name={screen === 'home' ? 'home' : 'home-outline'} size={20} color={screen === 'home' ? '#22c55e' : '#71717a'} />
          <Text style={[styles.tabLabel, screen === 'home' && { color: '#22c55e' }]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setScreen('leaderboard')} style={styles.tabItem}>
          <Ionicons name={screen === 'leaderboard' ? 'trophy' : 'trophy-outline'} size={20} color={screen === 'leaderboard' ? '#22c55e' : '#71717a'} />
          <Text style={[styles.tabLabel, screen === 'leaderboard' && { color: '#22c55e' }]}>Leaderboard</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setScreen('profile')} style={styles.tabItem}>
          <Ionicons name={screen === 'profile' ? 'person' : 'person-outline'} size={20} color={screen === 'profile' ? '#22c55e' : '#71717a'} />
          <Text style={[styles.tabLabel, screen === 'profile' && { color: '#22c55e' }]}>Profile</Text>
        </TouchableOpacity>
      </View>

      {/* ACTIVE RUN TRACKING MODAL */}
      <Modal animationType="slide" visible={isRunModalVisible} onRequestClose={() => {}}>
        <SafeAreaView style={styles.runModalContainer}>
          <StatusBar barStyle="light-content" />
          {(() => {
            const liveStats = computeRunStats(livePoints);
            const elapsedSec = runStartedAt ? Math.max(0, Math.floor((nowTick - runStartedAt) / 1000)) : 0;
            const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
            const secs = (elapsedSec % 60).toString().padStart(2, '0');
            return (
              <>
                <View style={styles.runModalHeader}>
                  <View style={styles.runModalLiveDot} />
                  <Text style={styles.runModalLiveText}>RECORDING</Text>
                </View>

                <View style={styles.runModalCenter}>
                  <Text style={styles.runModalTime}>{mins}:{secs}</Text>
                  <Text style={styles.runModalTimeLabel}>TIME</Text>

                  <View style={styles.runModalStatsRow}>
                    <View style={styles.runModalStat}>
                      <Text style={styles.runModalStatValue}>{(liveStats.distanceMeters / 1000).toFixed(2)}</Text>
                      <Text style={styles.runModalStatLabel}>KM</Text>
                    </View>
                    <View style={styles.runModalStat}>
                      <Text style={styles.runModalStatValue}>{liveStats.avgSpeedKmh || 0}</Text>
                      <Text style={styles.runModalStatLabel}>AVG KM/H</Text>
                    </View>
                    <View style={styles.runModalStat}>
                      <Text style={styles.runModalStatValue}>{liveStats.maxSpeedKmh || 0}</Text>
                      <Text style={styles.runModalStatLabel}>MAX KM/H</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.runModalActions}>
                  <TouchableOpacity onPress={handleDiscardRun} style={styles.runModalDiscardButton} disabled={isFinishingRun}>
                    <Ionicons name="trash-outline" size={20} color="#ef4444" />
                    <Text style={styles.runModalDiscardText}>Discard</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleStopRun} style={styles.runModalStopButton} disabled={isFinishingRun}>
                    {isFinishingRun ? <ActivityIndicator color="#000" /> : (
                      <>
                        <Ionicons name="stop-circle" size={24} color="#000" />
                        <Text style={styles.runModalStopText}>Stop & Save</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            );
          })()}
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
  },
  tabItem: { alignItems: 'center', gap: 4, minWidth: 70 },
  tabLabel: { color: '#71717a', fontSize: 10, fontWeight: '600' },
  runModalContainer: { flex: 1, backgroundColor: '#09090b', justifyContent: 'space-between', padding: 24 },
  runModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },
  runModalLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  runModalLiveText: { color: '#ef4444', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  runModalCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
});
