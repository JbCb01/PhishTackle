# PhishTackle - Dokumentacja Operacyjna dla Analityków CSIRT

PhishTackle to rozszerzenie przeglądarkowe wspierające w detekcji, weryfikacji i obsłudze incydentów phishingowych oraz dystrybucji złośliwego oprogramowania.

---

## Główne Zastosowania Operacyjne

### 1. Detekcja Złośliwych Domen w Czasie Rzeczywistym
- Integracja z oficjalną listą ostrzeżeń CERT.pl (hole.cert.pl) oraz praca w trybie lokalnej pamięci podręcznej.
- Korzyść operacyjna: Natychmiastowa identyfikacja złośliwych domen bez konieczności wykonywania zapytań sieciowych w trakcie rekonesansu, co eliminuje ryzyko wycieku zapytań DNS podczas analizy zagrożenia.

< PLACEHOLDER: Popup wtyczki z weryfikacją aktywnej domeny i szczegółami diagnostycznymi IP/SSL >

### 2. Diagnostyka Techniczna i Inspektor Połączeń
- Analiza adresu IP, dostawcy infrastruktury (WAF/CDN), certyfikatu SSL oraz statusu szyfrowania HTTP/HTTPS.
- Korzyść operacyjna: Błyskawiczna identyfikacja adresacji IP z funkcją szybkiego kopiowania do schowka, rozpoznawanie dostawców hostingu złośliwej infrastruktury oraz wykrywanie połączeń nieszyfrowanych bez używania zewnętrznych narzędzi.

### 3. Masowa Analiza Wyników Google (Google Search Assistant)
- Injekcja odznak statusu (BLOCKED / ON LIST) oraz pól wyboru bezpośrednio w wynikach wyszukiwania Google.
- Korzyść operacyjna: Identyfikacja kampanii reklamowych oszustw oraz typosquattingu. Analityk może zaznaczyć wiele złośliwych domen z poziomu wyszukiwarki i masowo dodać je do kolejki zgłoszeniowej.

< PLACEHOLDER: Wyniki wyszukiwania Google z odznakami blokad i paskiem masowego zgłaszania domen >

### 4. Rejestracja i Przygotowanie Zgłoszeń Incydentów
- Centralny panel zbierania domen z podziałem na kategorie (np. Fałszywe Inwestycje, Bankowość, Polityczne) oraz sesje dzienne z automatyczną deduplikacją.
- Korzyść operacyjna: Sprawne przygotowywanie ustrukturyzowanych list domen do przekazania do rejestru CERT.pl, dostawców abuse lub zasilenia reguł blokujących w systemach SIEM, EDR i Firewall.

< PLACEHOLDER: Panel zarządzania sesjami i raportowaniem incydentów >

### 5. Bezpieczne Pozyskiwanie Próbek Złośliwego Oprogramowania
- Przechwytywanie pobrań plików z opcją automatycznej izolacji (zmiana rozszerzenia na .sample).
- Korzyść operacyjna: Bezpieczne pobieranie artefaktów złośliwego oprogramowania bez ryzyka przypadkowego uruchomienia pliku wykonywalnego w środowisku analitycznym.

< PLACEHOLDER: Alert ochrony pobierania plików i izolacji próbek malware >

### 6. Neutralizacja Ataków na Schowek i Stabilizacja Analizy
- Wykrywanie nieautoryzowanych prób nadpisania schowka (Clipboard Hijacking) oraz blokowanie automatycznego odświeżania aktualności na portalu Facebook.
- Korzyść operacyjna: Ochrona przed podmienieniem portfeli lub linków w schowku oraz zachowanie ciagłości materiału dowodowego na portalach społecznościowych bez utraty widoku analizowanego posta.

### 7. Konfiguracja i Zarządzanie Wykluczeniami
- Konfiguracja reguł wykluczeń zaufanych domen (*.gov.pl, policja.pl, zus.pl) oraz zakresów IP infrastruktury WAF/CDN.
- Korzyść operacyjna: Eliminacja fałszywych alarmów (False Positives) dla domen instytucji publicznych i dostawców infrastruktury oraz dopasowanie rozszerzenia do wytycznych operacyjnych zespołu.

< PLACEHOLDER: Panel konfiguracji i zarządzania wykluczeniami oraz bazą ostrzeżeń >

---

## Skróty Operacyjne
- Alt+Shift+A: Przełączanie widoczności okna wtyczki (Popup) z poziomu dowolnej karty przeglądarki. Możliwość modyfikacji w menedżerze skrótów przeglądarki (about:addons).
