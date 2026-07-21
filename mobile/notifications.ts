import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const RUN_STATS_CHANNEL_ID = 'run-stats';
const RUN_STATS_NOTIFICATION_ID = 'run-stats-notification';
const DAILY_RECAP_NOTIFICATION_ID = 'daily-recap-notification';

export async function setupNotificationChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(RUN_STATS_CHANNEL_ID, {
    name: 'Yugurish statistikasi',
    importance: Notifications.AndroidImportance.LOW,
    sound: undefined,
    vibrationPattern: [0],
    showBadge: false,
  });
}

export async function requestNotificationPermission() {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  const result = await Notifications.requestPermissionsAsync();
  return result.status === 'granted';
}

function formatElapsed(elapsedSec: number): string {
  const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
  const secs = (elapsedSec % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

// Updates (not stacks - same identifier replaces the previous one) an ongoing
// low-priority notification with the run's live stats, so the runner can see
// progress from the notification shade without reopening the app.
export async function updateRunNotification(distanceMeters: number, elapsedSec: number, avgSpeedKmh: number) {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: RUN_STATS_NOTIFICATION_ID,
      content: {
        title: 'RunApp — yugurish davom etmoqda',
        body: `${(distanceMeters / 1000).toFixed(2)} km · ${formatElapsed(elapsedSec)} · ${avgSpeedKmh || 0} km/h`,
        sticky: true,
        autoDismiss: false,
        priority: Notifications.AndroidNotificationPriority.LOW,
      },
      trigger: null,
    });
  } catch {
    // Non-critical - the in-app live stats already show this
  }
}

export async function dismissRunNotification() {
  try {
    await Notifications.dismissNotificationAsync(RUN_STATS_NOTIFICATION_ID);
  } catch {
    // already dismissed/never shown
  }
}

// A once-a-day recap notification ("Bugun 3.2 km, bu hafta 12 km...") refreshed
// with the latest known totals whenever the app is opened, so it stays
// reasonably fresh without needing an always-on background service (which
// would be both a battery drain and hard to justify under Play Store's
// background location policy for an app that isn't actively tracking a run).
export async function refreshDailyRecapNotification(stats: {
  todayDistanceM: number;
  weekDistanceM: number;
  monthDistanceM: number;
}) {
  try {
    const fireDate = new Date();
    fireDate.setHours(20, 0, 0, 0);
    if (fireDate.getTime() <= Date.now()) {
      fireDate.setDate(fireDate.getDate() + 1);
    }

    const today = (stats.todayDistanceM / 1000).toFixed(2);
    const week = (stats.weekDistanceM / 1000).toFixed(2);
    const month = (stats.monthDistanceM / 1000).toFixed(2);

    await Notifications.scheduleNotificationAsync({
      identifier: DAILY_RECAP_NOTIFICATION_ID,
      content: {
        title: 'RunApp — kunlik hisobot',
        body: `Bugun: ${today} km · Bu hafta: ${week} km · Bu oy: ${month} km`,
        priority: Notifications.AndroidNotificationPriority.LOW,
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireDate },
    });
  } catch {
    // Non-critical
  }
}
