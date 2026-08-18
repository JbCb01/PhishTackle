# PhishTackle

PhishTackle to rozszerzenie przeglądarkowe (dostępne dla Firefox oraz Chrome) z wbudowanymi narzędziami automatyzującymi detekcję, inspekcję i rejestrację złośliwych domen.

---

## Skróty Klawiszowe

- **`Alt + Shift + Q`** (macOS: **`Command + Shift + Q`**) — szybkie otwarcie / zamknięcie okna popupu inspekcyjnego wtyczki z poziomu dowolnej karty.
- *Uwaga: Skrót można dostosować w menedżerze skrótów przeglądarki (`about:addons` / `chrome://extensions/shortcuts`).*

---

## Opis Funkcji

### Przegląd informacji

Wtyczka pozwala na szybkie sprawdzenie przeglądanej domeny pod kątem:
- **Obecności na liście `hole.cert.pl`**:
  - Wtyczka domyślnie co godzinę pobiera i cache'uje listę w pamięci podrzęcznej — istnieje więc szansa, że najświeższe domeny nie będą od razu widoczne. Na dole popupu dostępny jest przycisk ręcznego wymuszenia aktualizacji bazy.
- **Adresu IP, Providera / WAF-u i ASN**:
  - Odczyt adresu IP, dostawcy infrastruktury oraz numeru ASN. W ustawieniach można zdefiniować własną listę znanych WAF-ów (wtedy zamiast "Provider" wyświetla się "WAF").
- **Certyfikatu SSL**:
  - Podstawowe dane jak wystawca, dla kogo certyfikat został wystawiony oraz czas do wygaśnięcia (lub dni od wygaśnięcia).
  - *W wersji dla Chrome dane te są pobierane asynchronicznie poprzez zewnętrzny fallback SSL (CertSpotter, CRT.sh, TLS Probe).*

---

### Kolejka zgłoszeń i archiwum

- **Dodawanie domen do kolejki**:
  - Szybkie zgłaszanie przeglądanej strony z poziomu popupu lub ręczne dodanie dowolnego URL-a w oknie zgłoszeń.
  - Podział na kategorie i widok kolumn: **Domena / Link**, **Adres IP** oraz **Provider / WAF**.
- **Kopiowanie**:
  - **Copy Domains**: kopiowanie czystej listy domen (po enterach `\n`).
  - **Copy IPs**: kopiowanie zdeduplikowanych adresów IP po enterach (`\n`).
- **System Archiwizacji**:
  - Przycisk **Archive** przenosi obsłużone rekordy do osobnej zakładki z historią i datą archiwizacji.

---

### Integracja z Google Search (Google Assistant)

- Wstrzykiwanie odznak statusu (`CERT`, `LIST`) bezpośrednio przy wynikach wyszukiwania.
- Pasek akcji do masowego zaznaczania domen z wyników i zbiorczego dodawania ich do kolejki zgłoszeń.

---

### Podgląd skanów na URLScan.io (URLScan Assistant)

- Przycisk szybkiego otwarcia przekierowania bezpośrednio na kartach domen.
- Odznaki statusu (`CERT`, `LIST`) wbudowane w dolną część karty domeny.

---

### Funkcje eksperymentalne

- **Blokowanie odświeżania Facebooka `[BETA]`**:
  - Blokowanie automatycznego odświeżania aktualności na Facebooku (domyślnie wyłączone).
- **Ochrona pobierania plików `[BETA]`**:
  - Przechwytywanie pobieranych plików z opcją automatycznej izolacji poprzez zmianę rozszerzenia na `.sample` (domyślnie wyłączone).
- **Ochrona schowka `[BETA]`**:
  - Wykrywanie prób nieautoryzowanego podmieniania treści schowka (domyślnie wyłączone).

---

## Uwagi i błędy

Narzędzie rozwijane jest z myślą o maksymalnej automatyzacji pracy. Jeśli napotkasz błąd, masz uwagę dotyczącą działania wtyczki lub pomysł na nową funkcjonalność — pisz!
