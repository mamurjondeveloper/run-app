const { withAndroidManifest, withMainActivity } = require('@expo/config-plugins');

// Lets the tracking screen shrink into a small floating window (like Yandex
// Navigator / Google Maps) when the user leaves the app while a run is being
// recorded, instead of the app just disappearing. Android's PiP mode
// miniaturizes whatever the Activity is currently showing, so no extra
// rendering surface is needed - just permission to enter PiP.
//
// To only trigger this while a run is actually active (not every time the
// user backgrounds the app), MainActivity checks for the persistent
// "RunApp" foreground-service notification that expo-location already posts
// while GPS tracking is running, rather than adding a separate native
// bridge just to pass one boolean across from JS.
function withPipManifest(config) {
  return withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application[0];
    const activities = mainApplication.activity || [];
    const mainActivity = activities.find((a) => a.$['android:name'] === '.MainActivity');
    if (mainActivity) {
      mainActivity.$['android:supportsPictureInPicture'] = 'true';
      mainActivity.$['android:resizeableActivity'] = 'true';
      const existing = mainActivity.$['android:configChanges'] || '';
      const needed = ['screenSize', 'smallestScreenSize', 'screenLayout', 'orientation', 'keyboardHidden', 'keyboard', 'uiMode'];
      const parts = new Set(existing.split('|').filter(Boolean));
      needed.forEach((n) => parts.add(n));
      mainActivity.$['android:configChanges'] = Array.from(parts).join('|');
    }
    return config;
  });
}

function withPipMainActivity(config) {
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== 'kt') {
      // Only the Kotlin MainActivity template (Expo's default since ~SDK 49) is handled.
      return config;
    }

    let contents = config.modResults.contents;
    if (contents.includes('onUserLeaveHint')) {
      return config;
    }

    const importsToAdd = ['android.app.NotificationManager', 'android.app.PictureInPictureParams', 'android.os.Build'];
    importsToAdd.forEach((imp) => {
      const line = `import ${imp}`;
      if (!contents.includes(line)) {
        contents = contents.replace(/^package .+\n/, (m) => `${m}${line}\n`);
      }
    });

    const method = `
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        val hasActiveRun = nm.activeNotifications.any { sbn ->
          sbn.notification.extras.getCharSequence("android.title")?.toString() == "RunApp"
        }
        if (hasActiveRun) {
          enterPictureInPictureMode(PictureInPictureParams.Builder().build())
        }
      } catch (e: Exception) {
        // Best-effort only - never let PiP entry crash the app.
      }
    }
  }
`;

    const lastBraceIndex = contents.lastIndexOf('}');
    contents = contents.slice(0, lastBraceIndex) + method + contents.slice(lastBraceIndex);

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = function withPictureInPicture(config) {
  config = withPipManifest(config);
  config = withPipMainActivity(config);
  return config;
};
