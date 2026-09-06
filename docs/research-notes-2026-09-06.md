# Research Notes — 2026-09-06

These notes record time-sensitive facts used in the v0.2 implementation. They
are evidence snapshots, not permanent claims.

## Web Access

- Repository: <https://github.com/eze-is/web-access>
- Installed as a personal Codex skill on 2026-09-06; available after the next
  Codex turn starts.
- Uses a logged-in Chrome or Edge browser through CDP for platforms that are not
  reliably accessible through ordinary HTTP.
- Requires Node.js 22+ and browser remote debugging.
- The project explicitly warns that automated social browsing can trigger rate
  limits or account bans. Use a secondary account, dedicated profile, bounded
  batches, and pauses.

## WeChat / OpenClaw

- Tencent plugin: <https://github.com/Tencent/openclaw-weixin>
- The current plugin documentation supports text, image, video, and file
  messages and requires a compatible recent OpenClaw release.
- Main-account private-chat behavior remains a proof-of-concept item; do not rent
  a server until the local round trip is proven.

## Verified restaurant snapshots

### コーヒー マメヤ カケル

- Tabelog: <https://tabelog.com/tokyo/A1313/A131303/13255632/>
- Tabelog score observed: 3.50, 168 reviews.
- Official: <https://koffee-mameya.com/kakeru/>
- TableCheck: <https://www.tablecheck.com/en/koffee-mameya-kakeru/reserve/landing>
- TableCheck states reservations can be made up to one month ahead and asks
  same-day guests to contact the shop directly.

### とんかつ 成蔵

- Tabelog: <https://tabelog.com/tokyo/A1319/A131905/13236380/>
- Tabelog score observed: 4.28, 2,012 reviews.
- Official: <https://tonkatsu-narikura.com/>
- OMAKASE: <https://omakase.in/ja/r/qw473765>
- Tabelog currently describes the restaurant as reservation-only and includes a
  two-week-ahead reservation note. Exact slot release time must be rechecked on
  OMAKASE rather than inferred.

### オニバスコーヒー 中目黒駅前店

- Tabelog: <https://tabelog.com/tokyo/A1317/A131701/13191293/>
- Tabelog score observed: 3.58, 472 reviews; reservation unavailable.
- Official location: <https://onibuscoffee.com/pages/locations/nakameguro>

## Verified exhibition snapshot

- Official page: <https://hokusai-museum.jp/modules/Exhibition/exhibitions/view/5021>
- 開館10周年記念 特別展「ベスト オブ すみだ北斎美術館」
- Dates: 2026-09-15 through 2026-11-23, with a partial display change between
  the first and second periods.

## Data-use boundary

Store compact facts, source URLs, timestamps, and Andy's own notes. Do not copy
or republish large bodies of third-party review text. Live availability,
pricing, and reservation terms are rechecked at decision time.
