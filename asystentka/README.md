# KRAMM - Asystentka (etap 1)

Aplikacja: https://magdalenap-kramm.github.io/kramm-notatka/asystentka/

Co robi:
- o godzinie ustawionej przez agentkę przygotowuje poranny brief (kalendarz dziś i jutro, maile bez odpowiedzi, rozmowy z Notatki KRAMM, własne punkty) i wysyła powiadomienie,
- czyta brief na głos, czyta maile, pisze odpowiedzi (Claude) i wysyła je po potwierdzeniu głosem,
- głosem dodaje wydarzenia, przypomnienia i zadania do Kalendarza Google, mówi, co jest w kalendarzu,
- głosem dodaje i usuwa punkty codziennego sprawdzania oraz zmienia godzinę briefu.

Budowa:
- `asystentka/` - aplikacja na telefon (GitHub Pages), głos telefonu i rozpoznawanie mowy jak w Notatce KRAMM,
- `funkcje/` - zaplecze w Firebase (Google Cloud, region Warszawa): funkcja `api` i harmonogram `poranek` (co 5 minut),
- dane w Firestore, dostęp tylko z serwera (`firestore.rules`), stały dostęp do Google odświeżany na serwerze.

## Pierwsze uruchomienie (raz, najlepiej na komputerze)

1. **Firebase**: console.firebase.google.com -> Dodaj projekt -> wybierz istniejący projekt Google Cloud `calm-metric-514918-h8`. Przejdź na plan **Blaze** (płatność za użycie; przy tej skali zwykle mieści się w darmowym limicie Google, ale wymagana jest karta).
2. **Klient OAuth**: console.cloud.google.com -> Interfejsy API i usługi -> Dane logowania -> klient Notatki KRAMM:
   - w „Autoryzowane identyfikatory URI przekierowania” dodaj `https://magdalenap-kramm.github.io/kramm-notatka/asystentka/`,
   - skopiuj **Client secret** (jeśli nie jest widoczny: „Dodaj obiekt tajny”).
   - Ekran zgody OAuth musi mieć typ użytkownika **Wewnętrzny** (tylko kramm.pl) - wtedy dostęp do poczty nie wymaga weryfikacji przez Google.
3. **Klucz Claude**: console.anthropic.com -> API keys -> Create key (osobne konto API z doładowaniem, niezależne od subskrypcji claude.ai).
4. **Wdrożenie**: shell.cloud.google.com i wklej:
   ```
   git clone https://github.com/magdalenap-kramm/kramm-notatka && cd kramm-notatka && bash narzedzia/wdroz-asystentke.sh
   ```
   Skrypt zapyta o client secret i klucz Claude (wklejane niewidocznie), sam utworzy bazę, klucze powiadomień i wdroży funkcje.
5. Otwórz aplikację na iPhonie w Safari -> Udostępnij -> Do ekranu początkowego -> otwórz z ikony -> Połącz konto Google -> Ustawienia -> Włącz powiadomienia.

Aktualizacja zaplecza po zmianach w `funkcje/`: w Cloud Shell `cd kramm-notatka && git pull && bash narzedzia/wdroz-asystentke.sh`.
Aplikacja w `asystentka/` aktualizuje się sama po wypchnięciu na GitHub.

## Testy
`cd funkcje && npm install && npm test` - logika briefu, kalendarza i maili na atrapach API.

## Kolejne etapy
2. Sieć KRAMM: wiadomości i zadania między agentkami („napisz do Soni...”, „zadanie dla Sylwii...”).
3. Pilnowanie arkuszy z leadami: nowe wiersze i statusy wymagające akcji -> powiadomienie.
