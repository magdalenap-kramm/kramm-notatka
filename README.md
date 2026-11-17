# KRAMM - notatka po rozmowie

Aplikacja dla agentek KRAMM Nieruchomości: https://magdalenap-kramm.github.io/kramm-notatka/

Po rozmowie telefonicznej pyta głosem o numer, osobę, sprawę oraz alert lub zadanie. Agentka loguje się kontem Google @kramm.pl, a aplikacja sama zakłada na jej Dysku arkusz „Rozmowy - imię” i dopisuje do niego wiersze. Alerty i zadania trafiają do jej Kalendarza Google.

- Logowanie: Google OAuth, projekt Google Cloud `calm-metric-514918-h8`, klient typu aplikacja internetowa, dostęp tylko dla domeny kramm.pl.
- Uprawnienia: `drive.file` (tylko pliki założone przez aplikację), `calendar.events`.

## Asystentka KRAMM
Poranny brief, maile i kalendarz głosem: https://magdalenap-kramm.github.io/kramm-notatka/asystentka/ - opis i uruchomienie w [asystentka/README.md](asystentka/README.md).
