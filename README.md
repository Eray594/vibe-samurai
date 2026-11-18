# VIBE SAMURAI 侍 – Samurai-Sandbox

Physik-Schwertkampf im Browser: ein ummauerter Dōjō-Hof in der Abenddämmerung, Klingen mit echtem
Gewicht, Deckung und Abwehr im letzten Moment, Haltung brechen, Todesstoß.
Three.js + cannon-es liegen lokal in `vendor/` – kein Build, keine Installation, kein Internet nötig.

## Starten

| System | So geht's |
|---|---|
| **Windows** | Doppelklick auf `start.bat` (nutzt nur PowerShell, nichts zu installieren) |
| **macOS** | Doppelklick auf `start.command` (beim ersten Mal ggf. Rechtsklick → Öffnen) |
| **Linux** | `bash start.sh` |

Die Skripte starten einen kleinen lokalen Webserver und öffnen `http://localhost:8765`.
macOS/Linux nehmen, was vorhanden ist: `python3`, `node`, `php` oder `ruby`. Von Hand geht auch:

```bash
python3 -m http.server 8765      # oder: node tools/serve.mjs
```

Braucht einen aktuellen Browser mit WebGL 2 und Pointer Lock (getestet in Chrome; Edge, Firefox
und Safari nutzen dieselben Web-Standards).

## So spielt man – in 60 Sekunden

1. Spiel starten (siehe oben) und **ins Bild klicken** – damit wird die Maus gefangen. `Esc` gibt sie
   wieder frei, z. B. um oben in der Leiste Gegnertyp oder Modus zu wählen.
2. Mit **WASD** bewegen, mit der **Maus** umsehen. `R` holt einen Gegner in den Hof, `Tab` erfasst ihn.
3. **Linksklick** schlägt zu – mehrfach klicken ergibt eine Kombo, gedrückt halten einen schweren Hieb.
4. **Rechtsklick** hält die Deckung. Wer sie erst im letzten Moment hebt, **wehrt ab**: die Klinge des
   Gegners fliegt zur Seite, und ein sofortiger Linksklick wird zum Konter.
5. Es gibt keinen Lebensbalken, sondern **Haltung**. Abwehren und Treffer brechen die Haltung des
   Gegners – erscheint der rote **斬**-Marker über ihm, beendet ein Linksklick den Kampf per Todesstoß.
6. Selbst getroffen? `C` versorgt Wunden (3 Verbände), `Shift` weicht aus.
7. Wenn das sitzt: mit `M` die Modi durchschalten (Duell → Gefecht → Überleben → Chaos), mit `1`–`6`
   andere Waffen probieren. `H` blendet die Hilfe im Spiel ein und aus.

Die vollständige Tastenbelegung:

## Steuerung

| Taste | Aktion |
|---|---|
| WASD · Maus | bewegen (relativ zur Kamera) · Kamera |
| Shift | Ausweichschritt (kurz unverwundbar) · gehalten: Sprint |
| Space | Sprung – Angriff in der Luft = Sturzhieb |
| LMB | Hieb · mehrfach klicken: Kombo · halten: aufgeladener, schwerer Hieb · im Sprint: Ausfallstoß |
| RMB | Deckung. Erst im letzten Moment gehoben = **Abwehr** (Klinge des Gegners fliegt zur Seite) |
| LMB bei gebrochener Haltung | **Todesstoß** (roter 斬-Marker über dem Gegner) |
| LMB direkt nach einer Abwehr | **Konter**: sofortiger, tiefer Gegenhieb in kurzer Zeitlupe |
| LMB im Sprint (Schwerter) | **Durchschlag**: durch den Gegner hindurchrennen und im Vorbeigehen schneiden |
| F | **Tritt**: stößt Gegner um (sie stehen wieder auf), drückt eine Deckung ein, tritt Fässer, Krüge und Körper weg · im Sprint: Sprungtritt |
| Tab / mittlere Maustaste | Ziel erfassen · Mausrad: Ziel wechseln |
| Q · C · E | Kunai werfen · Wunden versorgen (3 Verbände) · Waffe aufheben / vom Ständer nehmen |
| V | „Freie Klinge": LMB halten und die Maus führt das Schwert direkt |
| 1–6 | Katana · Wakizashi · Nōdachi · Yari · Naginata · Kanabō |
| K | Skin: Rōnin · Samurai · Weißer Kranich · Schatten · Oni |
| R · T | Gegner spawnen · Verbündeten rufen |
| M | Modus: Duell → Gefecht (immer +3) → **Überleben** → **Chaos** |
| Z · N · H | Zeitlupe · Musik · Hilfe ein/aus |
| Backspace | Hof zurücksetzen · Esc gibt die Maus für die Leiste oben frei |

## Kampfsystem

- **Haltung statt Lebensbalken.** Geblockte Hiebe drücken auf die eigene Haltung, abgewehrte auf die
  des Angreifers. Bricht sie, taumelt der Kämpfer mit hängender Klinge – offen für den Todesstoß.
  Verwundete erholen ihre Haltung langsamer.
- **Die Klinge ist ein physischer Körper.** Jeder Hieb ist ein Handweg (Kesagiri, Shōmen, Yoko,
  Tsuki …), dem die Waffe mit Masse und Trägheit folgt. Schaden entsteht aus der Geschwindigkeit
  beim Auftreffen – Kante schneidet, Spitze sticht, Schaft und Keule prellen.
- **Verletzungen pro Körperteil.** Arme (Waffe sackt ab, Entwaffnung), Beine (Humpeln, Sturz),
  Kopf (Benommenheit, Bewusstlosigkeit), Blutung bis zum Verbluten.
- **Wie im Film.** Kombos werden mit jedem Treffer schneller und enthalten einen Wirbelhieb
  (Kaiten), der rundum alles trifft. Abgetrennte Glieder und der letzte fallende Gegner bekommen
  einen Moment Zeitlupe.
- **Verwundete bleiben Menschen.** Wer nicht mehr stehen kann, aber bei Bewusstsein ist, windet sich
  und zieht sich an den Armen vom Gegner weg – mit Blutspur. Bewusstlose kommen wieder zu sich und
  kämpfen weiter. Wer den Schwertarm verliert, hebt die Waffe mit links auf und kämpft schwächer
  weiter; Schwerverletzte weichen zurück statt anzugreifen, halten sich die Bauchwunde und stehen
  langsamer auf. Eine gebrochene Haltung zwingt fast auf ein Knie.
- **Rüstung.** Schnitte gleiten an lackierten Lamellen ab, Stiche finden Lücken, Wucht geht durch.
  Leichte Skins sind schneller, schwere halten mehr aus.
- **Gore.** Saubere, harte Schnitte trennen Arme, Beine oder den Kopf ab; Stümpfe spritzen, Klingen
  werden blutig, unter den Gefallenen bilden sich Lachen.
- **Gegner:** Ashigaru (Speer), Rōnin, Samurai, Oni-Krieger (Eisenkeule, kaum zu erschüttern),
  Daimyō (wehrt selbst ab). Oben in der Leiste wählbar oder zufällig.
- **Überleben:** Wellen, die jedes Mal größer, schneller und standfester werden; jede 5. Welle führt
  ein Daimyō an. Pro überstandener Welle gibt es einen Verband zurück. Wer fällt, hat verloren –
  Welle, Besiegte und Zeit werden gewertet, der Rekord bleibt gespeichert.
- **Chaos:** Es kommen ununterbrochen neue Gegner, immer mehr gleichzeitig (bis 14), und immer mehr
  greifen zugleich an. Gewertet werden Besiegte und Überlebenszeit.
- **Zerstörbares:** Kisten, Sake-Fässer, Tonkrüge, Papierwände und (mit Wucht) Steinlaternen
  zerbrechen in lose Teile; Strohmatten und Bambus lassen sich in beliebiger Höhe durchschneiden.
- **Sandbox:** Waffenständer, Verbündete, Zeitlupe. In Duell und Gefecht steht man nach 6 s wieder auf.

## Aufbau (`src/`)

| Datei | Inhalt |
|---|---|
| `main.js` | Game-Loop (120 Hz Fixed-Step), Treffer → Wunden, Block/Abwehr/Haltung, Todesstoß, Modi, Kamera, HUD |
| `combat.js` | Stellungen und Hiebe (Handposition + Klingenrichtung), Movesets pro Waffe, `AttackRunner` (Ausholen → Schlag → Halten → Rückführung), Haltungs-Werte |
| `player.js` | Eingabe, Kombos, Deckung, Lock-on, Sprint/Ausweichen/Sprung, Freie Klinge |
| `ai.js` | Gegner- und Verbündeten-KI: Ziel wählen, annähern, umkreisen, Kombos, blocken, abwehren, ausweichen |
| `samurai.js` | Kämpfer: aktiver Physik-Körper (PD-Balance), IK-Arme/-Beine, Ragdoll, Abtrennen, Haltung |
| `figure.js` | Prozedurale Figuren mit gemalten Gesichtern, Stoff- und Lamellentexturen: Kimono, Hakama, Dō, Sode, Kabuto, Kasa, Menpō … |
| `roster.js` | Skins des Spielers und Gegnertypen (Waffen, Können, Haltung, Aussehen) |
| `weapons.js` | Waffen-Definitionen (Masse, PD-Gains, Schaden), Modelle, PD-Antrieb |
| `injury.js` | Verletzungsmodell (Wunden, Rüstung, Blutung, Bewusstsein) |
| `arena.js` | Der Hof: Mauer, Torii, Pagode, Kirschbäume, Blütenblätter, Strohmatten, Bambus |
| `breakables.js` | Zerstörbare Objekte: Kisten, Fässer, Krüge, Papierwände, Steinlaternen |
| `effects.js` / `audio.js` | Blut, Funken, Decals / prozeduraler Web-Audio-Sound (Stahl, Taiko, Koto) |
| `physics.js` | Welt, Kollisionsgruppen, Mathe-Helfer |

Balance-Stellschrauben: `WEAPONS` in `weapons.js`, `TYPES`/`SKINS` in `roster.js`, `POSTURE` und
`DEFLECT_WINDOW` in `combat.js`.
