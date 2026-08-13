# Raffle v1 shared fixtures

These fixtures are synthetic and contain no API key, wallet address, real asset key, or raw MSU response.

- Web contract tests read `expectedJob`.
- raffle-api tests build the fixture-mode normalized result from `request` and compare `raffleResults`, `clears`, warnings, and errors.
- `raffleResults` contains every won raffle in the requested official weekly round, including non-Lucid/Will bosses, one result per raffle.
- `clears` contains Lucid and Will candidates grouped by boss difficulty only when official `partyCount` equals the saved roster and the matching raffle participation times span at most one hour (at least two histories for multi-person parties). It includes full saved-roster `members` and the subset `historyMemberIds`; missing-history members remain with zero acquisition. Up to three difficulty candidates may be returned per boss, and multiple selections are combined before settlement.
- Server tests use a sanitized synthetic upstream-shape case based on the observed official contract: nested `rewardKey.itemId`, decimal `winCount.value`, `clearInformations`, layer metadata, and item metadata. No real identifier or raw response is stored.
- Production Web code must not import this directory.