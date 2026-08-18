# PhishTackle — Dokumentacja Techniczna dla Analityków SOC / CSIRT

PhishTackle to rozszerzenie przeglądarkowe (dostępne dla Firefox oraz Chrome Manifest V3) zaprojektowane dla analityków bezpieczeństwa, zespołów CSIRT/SOC oraz Threat Intelligence. Narzędzie automatyzuje detekcję, inspekcję i rejestrację złośliwych domen, wspierając pozyskiwanie wskaźników kompromitacji (IoC).

---

## ⚡ Skróty Klawiszowe

- **`Alt + Shift + Q`** (macOS: **`Command + Shift + Q`**) — Błyskawiczne otwarcie okna popupu inspekcyjnego wtyczki z poziomu dowolnej karty.
- *Uwaga: Skrót można dostosować w menedżerze skrótów przeglądarki (`about:addons` / `chrome://extensions/shortcuts`).*

---

## 🔄 Ogólny Workflow Operacyjny

1. **Rekonesans & Detekcja**: Analysis wyników wyszukiwania w Google, rezultatów skanowań na URLScan.io lub bezpośrednia wizyta na badanej stronie.
2. **Automatyczna Weryfikacja & Pobieranie Contextu**:
   - Porównanie domeny z lokalną bazą ostrzeżeń `hole.cert.pl`.
   - Resolwowanie adresu IP poprzez Google DoH (DNS-over-HTTPS).
   - Identyfikacja dostawcy hostingu / WAF / CDN (poprzez API IPWhois).
   - Pobieranie oraz walidacja certyfikatu SSL (CertSpotter / CRT.sh / TLS Probe).
3. **Kwalifikacja & Masowe Zgłaszanie**: Wybór kategorii (np. *Fałszywe inwestycje*, *Bankowość*, *Phishing*) i dodanie domeny do aktywnej kolejki z poziomu popupu lub paska Google Search Assistant.
4. **Strukturyzacja IoC**: Wgląd w 3-kolumnową tabelę zgłoszeń (Domena, Adres IP, Dostawca/WAF).
5. **Eksport Wskaźników**: Jednoklikowe kopiowanie czystych domen lub zdeduplikowanych adresów IP (po enterach `\n`) do zasilenia systemów SIEM, EDR, Firewall lub przekazania do CERT.pl.
6. **Archiwizacja**: Przeniesienie obsłużonych wskaźników do zakładki **Archive** z zachowaniem historii i dat.

---

## 🧩 Stan Funkcjonalności (Feature Status)

### 🟢 Wdrożone i Gotowe (Production Ready)

- **Lokalna Baza Ostrzeżeń CERT.pl**:
  - Praca na lokalnym cache (>130 000 domen z `hole.cert.pl`) – brak wycieku zapytań DNS w trakcie rekonesansu.
  - Automatyczne odświeżanie w tle (alarmy) oraz ręczny przycisk odświeżenia.
- **Google Search Assistant**:
  - Wstrzykiwanie odznak statusu (`BLOCKED`, `ON LIST`) przy wynikach wyszukiwania.
  - Pusty pask akcji (`#phishtackle-action-bar`) do masowego zaznaczania domen i zgłaszania ich do kolejki.
  - Dekodowanie i czyszczenie linków przekierowujących z reklam i wyników.
- **URLScan Assistant & SSL Fallback Engine**:
  - Przycisk szybkiego otwarcia przekierowania URLScan w jaskrawoniebieskim kolorze (`#2563eb`).
  - 4-warstwowy mechanizm pobierania certyfikatów SSL (CertSpotter API, CertSpotter Apex Lookup dla certyfikatów wildcard `*.domain.com`, CRT.sh API oraz bezpośredni TLS HEAD Probe).
- **Live Inspector Popupu**:
  - Błyskawiczny odczyt aktywnego adresu IP oraz dostawcy (ISP / WAF / CDN).
  - Wyświetlanie wydawcy certyfikatu SSL, dni ważności oraz statusu szyfrowania.
  - Automatyczne odświeżanie treści popupu na żywo bez konieczności jego ponownego otwierania.
- **Zaawansowany Panel Raportów (`Reports View`)**:
  - Tabela 3-kolumnowa: **Domena / Link**, **Adres IP**, **Dostawca / WAF**.
  - Dedykowane przyciski eksportu: **Copy Domains** (czyste domeny) oraz **Copy IPs** (zdeduplikowane adresy IP po enterach).
  - Zakładka **Archive** z tabelą historii archiwizacji, datą oraz informacją o kategorii.
  - Zabezpieczenie dwustopniowe (*"Are you sure?"*) dla przycisków czyszczenia bazy.
- **Brak Sztywnych Sufiksów TLD**:
  - Uniwersalny parser nazw domen oparty na strukturze domenowej bez używania sztywnych tablic TLD.

---

### 🟡 W Trakcie Realizacji / Eksperymentalne (Beta & Optional)

- **Facebook Refresh Blocker `[BETA]`**:
  - Blokowanie automatycznego przeładowywania i odświeżania aktualności na portalu Facebook w trakcie analizy (domyślnie wyłączone).
- **Ochrona Pobierania Plików (Download Protection)**:
  - Przechwytywanie pobieranych plików z opcją automatycznej izolacji (zmiana rozszerzenia na `.sample`, domyślnie wyłączona).
- **Ochrona Schowka (Clipboard Protection)**:
  - Wykrywanie prób nieautoryzowanego podmieniania treści schowka (Clipboard Hijacking, domyślnie wyłączona).

---

## 🛠️ Zgłaszanie Uwag i Błędów

Narzędzie rozwijane jest z myślą o maksymalnej automatyzacji pracy analityków bezpieczeństwa. Jeśli napotkasz błąd, masz uwagę dotyczącą działania wtyczki lub pomysł na nową funkcjonalność:

1. **Utwórz Issue** w repozytorium projektu na GitHubie.
2. Opisz krótko przypadek (oraz załącz ew. zrzut ekranu lub błąd z konsoli tła `Service Worker`).
3. Mile widziane Pull Requesty z poprawkami i nowymi usprawnieniami!
