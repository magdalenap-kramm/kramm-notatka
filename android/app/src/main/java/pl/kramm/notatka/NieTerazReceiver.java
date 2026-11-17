package pl.kramm.notatka;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Przycisk "Nie teraz" w powiadomieniu: zamyka powiadomienie. */
public class NieTerazReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        ctx.getSystemService(NotificationManager.class).cancel(1);
    }
}
