# Japan Atlas catalog enrichment audit

Audit date: 2026-09-26 UTC. Production contains 44 records: 42 food, one
event, and one architecture entry.

## Current production outcome

Final public readback: **42/42 food records have descriptions and category tags**.
Six records were already enriched; 36 received narrow public-profile updates.
**28/42 food records have known reservation information**; 14 remain `unknown`.
No reservation lead times were invented.

The profile writes used exact item IDs and `updated_at` compare-and-set guards. They
changed only public payload fields (`description`, `tags`, `sources`,
`officialUrl`, and validated reservation evidence). Existing richer text,
known reservation rules, ratings, and user data were preserved. Assessment,
override, journal, visit, and media tables were not modified. Successful
Wrangler read/write audit output is retained in `/home/ubuntu/.config/.wrangler/logs/`
(the five 2026-09-26 batch logs show one-row writes and readbacks).

The six pre-existing enriched records were left untouched: Tokyo Mentsudan,
TONKATSU KEITA, 焼肉ホルモン金樹, KOFFEE MAMEYA Kakeru, ONIBUS COFFEE
Nakameguro, and とんかつ 成蔵. New updates covered six official-source
profiles and current branch-matched Tabelog profiles including ジャンボ はなれ,
焼鳥 にしき, 銀座のみこ寿司, 青森 帆立家, かぶと, らぁ麺や 嶋, れんこん,
DIWALI 梅田店, RODEO, 喫茶 月森, 炭火焼ホルモンたつや, 銀座 三よし,
かつれつ四谷たけだ, すし酒場 さしす, たん焼 忍, とんかつここまでやるか。 ,
and 松戸富田麺絆. Explicit current `予約不可` findings were recorded as
not-reservable; known rules were otherwise retained.

## Final batch: applied and read back

These 13 records were researched by the delegated GPT-5.6 Luna agent and
applied using the existing remote database connection. The parent completed
the remaining update and checked the final public API projection. Richer
existing descriptions and owner-provided booking rules were preserved.

| Record | Current source | Evidence captured |
| --- | --- | --- |
| Recoco Record Cafe / RECOCO | <https://tabelog.com/tokyo/A1303/A130301/13292348/> | Shibuya 3-1-10; café; 予約不可 |
| SHOGUN BURGER 新宿店 | <https://tabelog.com/tokyo/A1304/A130401/13227776/> | Kabukicho 1-15-12; hamburger/café/beer bar; 予約不可; wagyu burger profile |
| cois espresso club 本店 | <https://tabelog.com/tokyo/A1304/A130402/13319709/> | Current moved branch Shinjuku 1-6-11; café; 予約不可 |
| いーはとーぼ | <https://tabelog.com/tokyo/A1318/A131802/13012546/> | Kitazawa 2-34-9; coffee shop; 予約不可 |
| アルデバラン | <https://tabelog.com/tokyo/A1307/A130702/13278678/> | Current moved branch Azabu-juban 3-3-1; hamburger/creative/meat; reservable in 15-minute slots; burger selected at booking |
| シュトラウス | <https://tabelog.com/aomori/A0201/A020101/2000092/> | Aomori Shinmachi 1-13-21; cake/café; 予約不可 |
| セントル ザ・ベーカリー | <https://tabelog.com/tokyo/A1301/A130101/13157424/> | Ginza 1-2-1; bread/sandwich; 予約不可; café separately registered |
| 博多ラーメン長浜や 上野店 | <https://tabelog.com/tokyo/A1311/A131101/13144260/> | Ueno 7-2-1; ramen/tsukemen; 予約不可 |
| 浅草 生田庵 | <https://tabelog.com/tokyo/A1311/A131102/13255913/> | Hanakawado 1-6-4; ramen; 予約不可 |
| 遷sen | <https://tabelog.com/tokyo/A1305/A130501/13313917/> | Nishi-Ikebukuro 1-24-8; tsukemen/ramen; 予約不可 |
| 香氣 四川麺条 学芸大学店 | <https://tabelog.com/tokyo/A1317/A131702/13024183/> | Chuocho 1-17-12; ramen/tantanmen/Sichuan; 予約不可 |
| 麺散 | <https://tabelog.com/tokyo/A1306/A130601/13225567/> | Jingumae 6-13-7; udon; 予約不可 |
| らーめん改 | <https://tabelog.com/tokyo/A1311/A131103/13191776/> | Kuramae 4-20-10; ramen/tsukemen; 予約不可; current page identifies 貝塩らーめん |

Current pages were checked 2026-09-26 (Strauss was crawled the previous day).
Moved branches were matched to current addresses; old pages were not used.
Generic `予約可` was not converted into a lead-time claim.

Coverage means every restaurant now has a sourced basic overview and category,
not that every field is complete. Named dishes are included where supported;
some cafés and noodle shops retain short factual overviews rather than invented
menu recommendations. Reservation difficulty, lead time, queue length and
immediate walk-in availability remain unknown without specific evidence.

## Readback correction

The final batch initially supplied date-only research timestamps for eleven
records. The catalog validator requires ISO timestamps and temporarily omitted
those records from the public projection. Their evidence timestamps were
corrected to the corresponding write timestamps. Final API readback returned
44 total records, including all 42 restaurants; all 42 have category tags and
non-placeholder descriptions. Future enrichment scripts must validate proposed
payloads before writing and check public visibility after writing.

## Safety and recovery

Profile updates read the exact item payload and `updated_at` first; a changed
timestamp or address mismatch would abort the write. Patches never replaced a
full payload, preserving personal scores, favorites, visits, comments, and
photos. The timestamp repair changed only the invalid evidence timestamp and
update metadata. Recover only the recorded public JSON paths with a fresh CAS check;
never restore an entire payload. The event and architecture records were not
enriched as restaurants.
