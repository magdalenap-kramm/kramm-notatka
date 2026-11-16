package pl.kramm.notatka;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    static final int GRANAT = Color.rgb(46, 49, 146);
    TextView stan;
    Switch przelacznik;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(GRANAT);
        int dp = (int) getResources().getDisplayMetrics().density;

        LinearLayout kol = new LinearLayout(this);
        kol.setOrientation(LinearLayout.VERTICAL);
        kol.setBackgroundColor(Color.rgb(244, 239, 233));

        LinearLayout naglowek = new LinearLayout(this);
        naglowek.setBackgroundColor(GRANAT);
        naglowek.setPadding(20 * dp, 18 * dp, 20 * dp, 18 * dp);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.logo);
        logo.setAdjustViewBounds(true);
        naglowek.addView(logo, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, 40 * dp));
        kol.addView(naglowek);

        LinearLayout tresc = new LinearLayout(this);
        tresc.setOrientation(LinearLayout.VERTICAL);
        tresc.setPadding(20 * dp, 20 * dp, 20 * dp, 20 * dp);

        TextView tytul = tekst("Notatka po rozmowie", 22, true);
        tytul.setTextColor(GRANAT);
        tresc.addView(tytul);
        tresc.addView(tekst("Po każdej odebranej rozmowie przychodzącej pokażę powiadomienie „Dodaj notatkę”. "
                + "Dotknięcie otworzy aplikację KRAMM z wpisanym numerem i nazwą kontaktu.", 16, false));

        przelacznik = new Switch(this);
        przelacznik.setText("Powiadomienia po rozmowie");
        przelacznik.setTextSize(17);
        przelacznik.setPadding(0, 20 * dp, 0, 10 * dp);
        SharedPreferences p = getSharedPreferences(CallReceiver.PREFS, MODE_PRIVATE);
        przelacznik.setChecked(p.getBoolean("wlaczone", true));
        przelacznik.setOnCheckedChangeListener((v, on) -> {
            p.edit().putBoolean("wlaczone", on).apply();
            if (on) poprosOUprawnienia();
            odswiez();
        });
        tresc.addView(przelacznik);

        stan = tekst("", 15, false);
        tresc.addView(stan);

        tresc.addView(przycisk("Nadaj uprawnienia", v -> poprosOUprawnienia()));
        tresc.addView(przycisk("Pokaż próbne powiadomienie", v ->
                CallReceiver.pokazPowiadomienie(this, "+48 600 000 000", "Test KRAMM")));
        tresc.addView(przycisk("Otwórz notatkę teraz", v ->
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(CallReceiver.URL_APLIKACJI)))));
        tresc.addView(przycisk("Ustawienia baterii (jeśli powiadomienia nie przychodzą)", v -> {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
            startActivity(i);
        }));

        kol.addView(tresc);
        ScrollView sv = new ScrollView(this);
        sv.addView(kol);
        setContentView(sv);
        poprosOUprawnienia();
    }

    @Override
    protected void onResume() {
        super.onResume();
        odswiez();
    }

    TextView tekst(String t, int rozmiar, boolean gruby) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(rozmiar);
        v.setTextColor(Color.rgb(29, 29, 43));
        v.setLineSpacing(0, 1.2f);
        v.setPadding(0, 8, 0, 8);
        if (gruby) v.setTypeface(Typeface.DEFAULT_BOLD);
        return v;
    }

    Button przycisk(String t, android.view.View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(t);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setBackgroundColor(GRANAT);
        b.setGravity(Gravity.CENTER);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (12 * getResources().getDisplayMetrics().density);
        b.setLayoutParams(lp);
        return b;
    }

    String[] potrzebne() {
        List<String> l = new ArrayList<>();
        l.add(Manifest.permission.READ_PHONE_STATE);
        l.add(Manifest.permission.READ_CALL_LOG);
        if (Build.VERSION.SDK_INT >= 33) l.add(Manifest.permission.POST_NOTIFICATIONS);
        return l.toArray(new String[0]);
    }

    void poprosOUprawnienia() {
        List<String> brak = new ArrayList<>();
        for (String s : potrzebne()) if (checkSelfPermission(s) != PackageManager.PERMISSION_GRANTED) brak.add(s);
        if (!brak.isEmpty()) requestPermissions(brak.toArray(new String[0]), 1);
    }

    @Override
    public void onRequestPermissionsResult(int kod, String[] uprawnienia, int[] wyniki) {
        odswiez();
    }

    void odswiez() {
        boolean wszystkie = true;
        for (String s : potrzebne()) if (checkSelfPermission(s) != PackageManager.PERMISSION_GRANTED) wszystkie = false;
        if (!przelacznik.isChecked()) stan.setText("Wyłączone - nie pokażę powiadomień po rozmowach.");
        else if (wszystkie) stan.setText("✓ Działa. Po odebranej rozmowie pojawi się powiadomienie.");
        else stan.setText("Brakuje uprawnień. Dotknij „Nadaj uprawnienia” i zezwól na: telefon, rejestr połączeń, powiadomienia.");
    }
}
