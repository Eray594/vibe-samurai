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

**Leistung:** Der Knopf „Auto · … fps“ in der Leiste zeigt die Bildrate. In der Einstellung *Auto*
senkt oder hebt das Spiel Auflösung, Schatten, Leuchteffekt und Laternenlichter von selbst, um die
Bildrate des Bildschirms zu halten. Ein Klick schaltet auf feste Stufen (Niedrig, Mittel, Hoch).

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
| Shift | Ausweichschritt (kurz unverwundbar) · gehalten: Sprint · im letzten Moment: **perfektes Ausweichen** (Zeitlupe + freier Konter) |
| Shift in einen Stoß hinein | **Klinge niedertreten**: der Fuß landet auf der Waffe, die Haltung des Gegners leidet schwer |
| Space | Sprung – Angriff in der Luft = Sturzhieb · an der Mauer nochmal Space: **Wandsprung** · im Sprint gegen die Mauer: höherer Sprung |
| Space gegen das Podest | **Klettern**: über die Stufe geht es von selbst aufs Deck; vom Boden aus greifst du die Kante und hängst – Space zieht hoch, S lässt los |
| Maus kurz ziehen, dann LMB | **Hiebrichtung**: von oben, seitlich, schräg oder von unten – je nachdem, wohin die Maus ging (ohne Ziehen läuft die Kombo) |
| LMB in der Luft über einem Gegner | **Sturzangriff**: aus der Höhe (Podest, Wandsprung) gezielt auf ihn herab, reißt ihn zu Boden und bricht jede Deckung |
| Space am Boden, im richtigen Moment | **Abrollen**: nach einem Niederschlag sofort wieder auf die Füße (ein Versuch pro Sturz) |
| Space über einen Feger, dann F | **Sprungtritt** als Konter |
| X im Sprint | **Rutschen**: unter hohen Hieben durch · LMB dabei: Hieb auf die Beine |
| LMB | Hieb · mehrfach klicken: Kombo · halten: aufgeladener, schwerer Hieb · im Sprint: Ausfallstoß |
| RMB | Deckung. Erst im letzten Moment gehoben = **Abwehr** (Klinge des Gegners fliegt zur Seite) |
| LMB bei gebrochener Haltung | **Todesstoß** (roter 斬-Marker über dem Gegner) |
| LMB direkt nach einer Abwehr | **Konter**: sofortiger, tiefer Gegenhieb in kurzer Zeitlupe |
| LMB im Sprint (Schwerter) | **Durchschlag**: durch den Gegner hindurchrennen und im Vorbeigehen schneiden |
| F | **Tritt**: stößt Gegner um (sie stehen wieder auf), drückt eine Deckung ein, tritt Fässer, Krüge und Körper weg · im Sprint: Sprungtritt |
| B halten, loslassen | **Iai**: aufgeladener Zieh-Hieb durch den Gegner hindurch (nur Schwerter) |
| Mausrad (ohne Ziel) / L | **Haltung**: Gedan (tief, schnell) · Chūdan · Jōdan (hoch, wuchtig) |
| G | **Packen**: Gegner am Kragen als Schild halten · LMB / G / F: **werfen** (reißt andere um, zerschlägt Kisten) |
| RMB halten + Q | **Waffe werfen** – danach mit E zurückholen oder die Waffe eines Gefallenen nehmen |
| LMB hämmern bei Klingenbindung | Treffen sich zwei Hiebe, verhaken die Klingen – wer stärker drückt, gewinnt |
| Tab / mittlere Maustaste | Ziel erfassen · Mausrad: Ziel wechseln |
| Q · C · E | Kunai werfen · Wunden versorgen (3 Verbände) · Waffe aufheben / vom Ständer nehmen |
| V | „Freie Klinge": LMB halten und die Maus führt das Schwert direkt |
| 1–6 | Katana · Wakizashi · Nōdachi · Yari · Naginata · Kanabō |
| K | Skin: Rōnin · Samurai · Weißer Kranich · Schatten · Oni |
| R · T | Gegner spawnen · Verbündeten rufen |
| M | Modus: Duell → Gefecht (immer +3) → **Überleben** → **Chaos** → **2 Spieler** → **Training** |
| I | Menü: Einstellungen und Dōjō |
| O | Training: nächste Übung |
| U | Wetter / Tageszeit: Abenddämmerung → Nacht → Regen → Schnee |
| P | Wiederholung des Todesstoßes an/aus |
| Z · N · H | Zeitlupe · Musik · Hilfe ein/aus |
| Backspace | Hof zurücksetzen · Esc gibt die Maus für die Leiste oben frei |

## Training

Im Modus **Training** macht ein Übungspartner immer nur eine Sache, damit sich die Antwort darauf
einschleifen lässt: Hiebe (abwehren), Stöße (niedertreten), Feger (überspringen), schwere Hiebe
(ausweichen), Pfeile, ein stillstehender Gegner für Kombos und zuletzt freier Kampf. Oben links
steht, was zu tun ist und wie oft es gelungen ist; `O` wechselt zur nächsten Übung. Du nimmst hier
kaum Schaden, und Ehre gibt es keine.

## Ehre, Rang und Dōjō

Jeder Besiegte bringt Ehre (mehr für ranghohe Gegner), jede überstandene Überleben-Welle ebenfalls.
Die gesamte verdiente Ehre bestimmt deinen Rang (Ashigaru → Rōnin → Samurai → Hatamoto → Daimyō →
Shōgun), angezeigt unten links. Im Menü (`I`) lässt sich Ehre im **Dōjō** dauerhaft eintauschen:
vierter Verband, zweites Kunai, mehr Haltung, schnelleres Iai, schnellere Erholung und zwei
zusätzliche Skins (Weißer Geist, Goldener Daimyō). Alles, was es vorher schon gab, bleibt frei.
Der Fortschritt liegt im Browser auf diesem Rechner.

Im selben Menü: Mausempfindlichkeit, Lautstärke, Blut an/aus, Duell-Eröffnung an/aus und
Wiederholung an/aus.

## Körper und Gewicht

- **Ausdauer** (grüner Balken unter der Haltung): Hiebe, Ausweichen, Sprint, Sprung und geblockte
  Schläge kosten Atem. Ist er leer, bist du kurz außer Atem – kein Sprint, kein Ausweichschritt,
  langsamere Hiebe, kürzeres Abwehrfenster. Er kommt nach einer kurzen Pause zurück.
- **Schwung.** Ein schwerer Hieb, der nichts trifft, reißt den Körper herum und braucht länger
  zurück in die Deckung. Das gilt auch für Gegner: nach einem ausgewichenen 危-Hieb sind sie offen.
- **Gleichgewicht.** Wer aus dem Gleichgewicht ist, schwankt sichtbar und stolpert ein paar Schritte.
- **Rolle.** Leichte Skins (Rōnin, Schatten, Weißer Geist) rollen beim Ausweichen über die Schulter;
  schwere machen einen kurzen Schritt.
- **Trägheit.** Wer aus dem Sprint scharf wendet, muss erst abbremsen.
- **Klinge steckt.** Ein tiefer Stich oder ein voller Hieb in Holz hält die Waffe einen Moment fest.

## Angriffe lesen

Über dem Kopf eines Gegners erscheint beim Ausholen ein Zeichen, wenn der Angriff eine besondere
Antwort verlangt:

| Zeichen | Bedeutet | Antwort |
|---|---|---|
| **突** (blau) | Stoß | mit Shift **hinein**weichen – der Fuß tritt die Waffe nieder |
| **足** (gelb) | Feger auf die Beine | **springen**, in der Luft F für den Sprungtritt |
| **危** (rot) | schwerer Hieb oder Schuss | nicht blocken – **ausweichen** (er bricht jede Deckung) |
| **弓** (weiß) | Pfeil | blocken, ausweichen oder mit der Klinge aus der Luft schlagen |

## 2 Spieler am selben Rechner

Modus **2 Spieler** (Taste M): Spieler 1 wie gewohnt, Spieler 2 mit Gamepad – oder ohne Gamepad auf
der rechten Tastaturseite. Die Kamera steht seitlich und hält beide im Bild.

| Aktion | Gamepad | Tastatur |
|---|---|---|
| Bewegen | linker Stick | Pfeiltasten |
| Hieb | X / RB | `,` oder Numpad 1 |
| Deckung | LB | `.` oder Numpad 2 |
| Ausweichen | B | `-` oder Numpad 3 |
| Sprung | A | Enter oder Numpad 0 |
| Tritt | Y | `#` oder Numpad 5 |
| Iai · Kunai | LT · RT | – |
| Haltung · Packen · Waffe wechseln | Steuerkreuz hoch · runter · links/rechts | Numpad 7 · 9 · 4/6 |

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
  Daimyō (wehrt selbst ab), **Bogenschütze** (hält Abstand, Pfeile lassen sich abwehren),
  **Teppō-Schütze** (Luntenschloss: lange Ansage, nicht zu blocken) und **Reiter** (prescht durch
  den Hof, reitet nieder; ein harter Treffer aufs Pferd oder ein Tritt holt ihn herunter).
  Oben in der Leiste wählbar oder zufällig.
- **Gegner klettern nach.** Wer aufs Podest flieht, bekommt Besuch.
- **Moral.** Fällt der Anführer oder rollt ein Kopf, verlieren die Zaghaften für einige Sekunden
  den Mut und weichen zurück.
- **Duell-Eröffnung.** Jedes Duell beginnt Auge in Auge, die Hand am Griff: warten, bis der Gegner
  zuckt (**今**), dann LMB. Schneller gezogen = ein einziger Schnitt. Zu früh oder zu spät kostet
  Haltung oder Blut. RMB überspringt.
- **Wiederholung.** Der Todesstoß, der den Kampf beendet, läuft noch einmal in Zeitlupe aus
  kreisender Kamera (Klick überspringt, P schaltet ab).
- **Wetter.** Nacht (nur Laternen und Mond), Regen (rutschiger Boden, Feuer erlischt), Schnee
  (jeder verwundete Schritt hinterlässt eine Spur).
- **Feuer.** Eine zerschlagene Laterne setzt ihr Öl in Brand; das Feuer greift auf Papierwände,
  Kisten, Fässer und Strohmatten über und verbrennt, wer darin steht.
- **Überleben:** Wellen, die jedes Mal größer, schneller und standfester werden; jede 5. Welle führt
  ein Daimyō an. Pro überstandener Welle gibt es einen Verband zurück und **eine von drei
  Verbesserungen zur Wahl** (Tasten 1–3), die bis zum Ende des Laufs bleiben. Wer fällt, hat verloren –
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
| `player.js` | Eingabe, Kombos, Deckung, Lock-on, Sprint/Ausweichen/Sprung, Haltungen, Iai, Freie Klinge, Gamepad-Eingabe |
| `ai.js` | Gegner- und Verbündeten-KI: Ziel wählen, annähern, umkreisen, Kombos, blocken, abwehren, ausweichen |
| `samurai.js` | Kämpfer: aktiver Physik-Körper (PD-Balance), IK-Arme/-Beine, Ragdoll, Abtrennen, Haltung |
| `figure.js` | Prozedurale Figuren mit gemalten Gesichtern, Stoff- und Lamellentexturen: Kimono, Hakama, Dō, Sode, Kabuto, Kasa, Menpō … |
| `roster.js` | Skins des Spielers und Gegnertypen (Waffen, Können, Haltung, Aussehen) |
| `weapons.js` | Waffen-Definitionen (Masse, PD-Gains, Schaden), Modelle, PD-Antrieb |
| `injury.js` | Verletzungsmodell (Wunden, Rüstung, Blutung, Bewusstsein) |
| `arena.js` | Der Hof: Mauer, Torii, Pagode, Kirschbäume, Blütenblätter, Strohmatten, Bambus |
| `breakables.js` | Zerstörbare Objekte: Kisten, Fässer, Krüge, Papierwände, Steinlaternen |
| `effects.js` / `audio.js` | Blut, Funken, Decals / prozeduraler Web-Audio-Sound (Stahl, Taiko, Koto) |
| `world.js` | Wetter und Tageszeit, Feuer, das Podest zum Klettern |
| `mount.js` | Pferd für berittene Gegner |
| `extras.js` | Klingenbindung, Duell-Eröffnung, Verbesserungen, Wiederholung, 2-Spieler-Modus |
| `meta.js` | Einstellungen, Ehre und Dōjō, Menü, Trainingsübungen |
| `perf.js` | Automatische Grafikqualität, Zusammenfassen statischer Geometrie |
| `physics.js` | Welt, Kollisionsgruppen, Mathe-Helfer |

Balance-Stellschrauben: `WEAPONS` in `weapons.js`, `TYPES`/`SKINS` in `roster.js`, `POSTURE` und
`DEFLECT_WINDOW` in `combat.js`.
