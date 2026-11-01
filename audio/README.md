# Optional audio uploads

Upload all audio files to the repository-root audio folder. The website reads files from /audio/.

For each slot, upload both formats using the exact base filename:
- MP3: primary source
- OGG: fallback source

Recommended files are short, compressed and cleanly looped where applicable. Background tracks should be seamless stereo loops; UI effects should be short clips without long silence. The audio engine waits for the first entry gesture before starting playback and skips files that are not present.

| Filename | Path | Trigger | Loop | Recommended duration | Slot volume |
|---|---|---|---|---|---|
| bg-home.mp3 / bg-home.ogg | /audio/ | Homepage | Yes | 60–180 seconds | 0.80 |
| bg-play.mp3 / bg-play.ogg | /audio/ | /play browser player | Yes | 60–180 seconds | 0.70 |
| bg-missions.mp3 / bg-missions.ogg | /audio/ | Mission/category route, if present | Yes | 60–180 seconds | 0.70 |
| bg-info.mp3 / bg-info.ogg | /audio/ | About, Controls, FAQ and Blog | Yes | 60–180 seconds | 0.65 |
| bg-download.mp3 / bg-download.ogg | /audio/ | Download route, if present | Yes | 60–180 seconds | 0.70 |
| bg-default.mp3 / bg-default.ogg | /audio/ | Other routes | Yes | 60–180 seconds | 0.65 |
| ui-click.mp3 / ui-click.ogg | /audio/ | Button and non-navigation link click | No | 40–180 ms | 0.62 |
| ui-move.mp3 / ui-move.ogg | /audio/ | Arrow Up/Down navigation movement | No | 40–150 ms | 0.35 |
| ui-hover.mp3 / ui-hover.ogg | /audio/ | Optional menu hover; disabled until verified | No | 30–120 ms | 0.18 |
| ui-change.mp3 / ui-change.ogg | /audio/ | Internal page/category navigation | No | 100–450 ms | 0.55 |
| ui-enter.mp3 / ui-enter.ogg | /audio/ | First-session entry/unlock | No | 100–500 ms | 0.60 |
| ui-error.mp3 / ui-error.ogg | /audio/ | Invalid form feedback | No | 80–350 ms | 0.55 |

## GitHub upload steps

1. Open the project repository on GitHub.
2. Create or open the audio folder at the repository root.
3. Choose Add file, then Upload files.
4. Upload each MP3 and matching OGG file with the exact names in the table.
5. Commit the files to the redesign-oct30 branch.
6. Wait for the matching Vercel deployment to become Ready, then hard-refresh the site and test sound, mute and volume.

No audio binary is included in this change. Upload only audio files that you own or are licensed to distribute. The names and triggers above are the site's requested audio slots, not a report of files observed on the inaccessible reference.
