package pl.kramm.notatka;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.CallLog;
import android.telephony.TelephonyManager;

/**
 * Po zakończeniu odebranego połączenia przychodzącego pokazuje powiadomienie
 * "Dodaj notatkę", które otwiera aplikację KRAMM z wpisanym numerem i nazwą kontaktu.
 */
public class CallReceiver extends BroadcastReceiver {

    static final String URL_APLIKACJI = "https://magdalenap-kramm.github.io/kramm-notatka/";
    static final String KANAL = "notatki";
    static final String PREFS = "stan";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("wlaczone", true)) return;

        String stan = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        String numer = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);
        if (stan == null) return;

        if (TelephonyManager.EXTRA_STATE_RINGING.equals(stan)) {
            SharedPreferences.Editor e = p.edit().putBoolean("dzwoni", true).putBoolean("odebrane", false);
            if (numer != null) e.putString("numer", numer);
            e.apply();
        } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(stan)) {
            if (p.getBoolean("dzwoni", false)) p.edit().putBoolean("odebrane", true).apply();
        } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(stan)) {
            boolean odebrane = p.getBoolean("dzwoni", false) && p.getBoolean("odebrane", false);
            String zapisany = p.getString("numer", "");
            p.edit().putBoolean("dzwoni", false).putBoolean("odebrane", false).remove("numer").apply();
            if (!odebrane) return;

            // rejestr połączeń zapisuje się chwilę po rozłączeniu - czekamy 2 s
            final PendingResult wynik = goAsync();
            final Context app = ctx.getApplicationContext();
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    String[] dane = ostatniePolaczenie(app);
                    String nr = dane[0] != null && !dane[0].isEmpty() ? dane[0] : zapisany;
                    pokazPowiadomienie(app, nr, dane[1]);
                } finally {
                    wynik.finish();
                }
            }, 2000);
        }
    }

    /** [numer, nazwa kontaktu] ostatniego połączenia przychodzącego z rejestru. */
    static String[] ostatniePolaczenie(Context ctx) { return ostatniePolaczenie(ctx, false); }

    /** wszystkie=true: także wychodzące; tylko połączenia z ostatnich 12 godzin. */
    static String[] ostatniePolaczenie(Context ctx, boolean wszystkie) {
        String[] w = new String[]{null, null};
        if (ctx.checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return w;
        try (Cursor c = ctx.getContentResolver().query(CallLog.Calls.CONTENT_URI,
                new String[]{CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME, CallLog.Calls.TYPE, CallLog.Calls.DATE},
                null, null, CallLog.Calls.DATE + " DESC")) {
            if (c != null && c.moveToFirst()
                    && (c.getInt(2) == CallLog.Calls.INCOMING_TYPE || (wszystkie && c.getInt(2) == CallLog.Calls.OUTGOING_TYPE))
                    && (!wszystkie || System.currentTimeMillis() - c.getLong(3) < 12L * 3600 * 1000)) {
                w[0] = c.getString(0);
                w[1] = c.getString(1);
            }
        } catch (Exception ignored) { }
        return w;
    }

    static void utworzKanal(Context ctx) {
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel k = new NotificationChannel(KANAL, "Notatka po rozmowie", NotificationManager.IMPORTANCE_HIGH);
        k.setDescription("Przypomnienie o notatce po odebranej rozmowie");
        nm.createNotificationChannel(k);
    }

    static Uri adresNotatki(String numer, String nazwa) {
        Uri.Builder url = Uri.parse(URL_APLIKACJI).buildUpon();
        if (numer != null && !numer.isEmpty()) url.appendQueryParameter("numer", numer);
        if (nazwa != null && !nazwa.isEmpty()) url.appendQueryParameter("kto", nazwa);
        return url.build();
    }

    static void pokazPowiadomienie(Context ctx, String numer, String nazwa) {
        utworzKanal(ctx);
        Uri.Builder url = Uri.parse(URL_APLIKACJI).buildUpon();
        if (numer != null && !numer.isEmpty()) url.appendQueryParameter("numer", numer);
        if (nazwa != null && !nazwa.isEmpty()) url.appendQueryParameter("kto", nazwa);
        Intent otworz = new Intent(Intent.ACTION_VIEW, url.build()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(ctx, (int) System.currentTimeMillis(), otworz,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        String kto = nazwa != null && !nazwa.isEmpty() ? nazwa : (numer != null && !numer.isEmpty() ? numer : "nieznany numer");
        Notification n = new Notification.Builder(ctx, KANAL)
                .setSmallIcon(android.R.drawable.ic_menu_edit)
                .setContentTitle("Dodaj notatkę po rozmowie")
                .setContentText("Rozmowa z: " + kto + ". Dotknij, aby zapisać.")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .build();
        if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                || android.os.Build.VERSION.SDK_INT < 33) {
            ctx.getSystemService(NotificationManager.class).notify(1, n);
        }
    }
}
