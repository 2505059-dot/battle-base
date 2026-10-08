# PES–FIFA schema comparison and conversion risk

## PES 5 fields as displayed

The parser retains the original PES Master field names, order, and integer values; it does not map them into FIFA names:

`Attack`, `Defence`, `Balance`, `Stamina`, `Top Speed`, `Acceleration`, `Reponse` (PES Master page spelling), `Agility`, `Dribble Accuracy`, `Dribble Speed`, `Short Pass Accuracy`, `Short Pass Speed`, `Long Pass Accuracy`, `Long Pass Speed`, `Shot Accuracy`, `Shot Power`, `Shot Technique`, `Free Kick Accuracy`, `Swerve`, `Heading`, `Jump`, `Technique`, `Aggression`, `Mentality`, `Goalkeeping`, `Teamwork`, `Consistency`, `Condition`.

PES Master also shows six summary columns (Pas, Sht, Phy, Def, Spd, Dri) and a displayed OVR. They are separate from the 28-field detail table. Neither OVR nor any raw value is clipped to 1–99.

## Possible FIFA correspondences

The FIFA column below combines contemporary FIFA 05 guide terminology and later FIFAIndex page labels. A matching English word does not prove identical internal definitions, ranges, or scale.

| PES 5 field(s) | Possible FIFA 05/06 counterpart | Assessment |
|---|---|---|
| Acceleration | Acceleration | Closest semantic match; compare distributions only after verifying edition-specific scale and source columns. |
| Top Speed | Pace; later page label Sprint Speed | Approximate. Older FIFA guides use Pace, while FIFAIndex currently presents a modern-shaped field taxonomy. |
| Stamina | Stamina | Close label-level match; scale/OVR impact can still differ. |
| Balance | Balance; sometimes entangled with Strength in older models | Approximate; do not merge with strength without a version-specific schema. |
| Shot Accuracy | Shot Accuracy / finishing | Similar intent, not proven equivalent. |
| Shot Power | Shot Power | Close lexical match; values and weighting differ. |
| Heading | Heading / Heading Accuracy | Close semantic match, not a demonstrated one-to-one native column. |
| Short Pass Accuracy; Long Pass Accuracy | Passing; Long Balls / long passing | PES separates accuracy and speed; older FIFA guide labels combine or partition skills differently. |
| Short Pass Speed; Long Pass Speed | Passing power / long-ball execution | No stable one-to-one mapping established. |
| Dribble Accuracy; Dribble Speed; Agility | Dribbling, ball control, agility | Related concepts split differently; no reliable direct conversion. |
| Attack; Defence | Attack Position, marking, tackling, defensive awareness | PES broad ratings versus FIFA's more granular or differently named skills. |
| Response | Reactions, positioning, anticipation | No verified equivalent; “Reponse” is the source label typo. |
| Goalkeeping | Handling, positioning, reflexes, rushing | PES has one field here; FIFA keeper data is multi-field. |
| Free Kick Accuracy; Swerve | Free-kick accuracy, curve | Approximate concepts; no verified matching column/range. |
| Jump | Jumping / aerial ability | Related but not a stable direct FIFA 05 field. |
| Technique; Teamwork; Consistency; Condition; Mentality; Aggression | Ball control, teamwork, composure, work rate/aggression, form | Definitions and availability vary; these should stay PES-only until original edition schemas are confirmed. |

A current FIFAIndex FIFA 05 page displays fields such as ball control, dribbling, attack position, aggression, composure, vision, crossing, passing, acceleration/sprint speed, stamina, strength/balance, heading accuracy, finishing and shot power. A contemporary FIFA 05 guide uses an older vocabulary such as Pace, Shot Accuracy/Power, Passing, Long Balls, Dribbling, Heading, Tackling, Strength, Marking, and goalkeeper Handling/Positioning/Reflexes/Rushing. Treat those as different views of legacy releases, not proof of a canonical field-by-field table.

## Small overlap diagnostic, not calibration

PES Master Valencia pages and FIFAIndex FIFA 05 pages yielded three identity pairs with matching Valencia context, nationality and shirt/height evidence. FIFAIndex's page labels may be standardized to a later schema; this small display comparison is not proof of the original console FIFA 05 columns.

Three source identity pairs were reviewed using matching team, nationality, and shirt/height evidence. Exact OVRs, detailed attributes, and derived OVR deltas are omitted pending source redistribution clearance. The small cohort and unresolved edition/formula provenance do not support a PES-to-FIFA conversion.

## Historical coverage and adapter recommendation

PES 5 adds potentially useful 2005-era pages for names missing or mismatched in FIFA 05 records, but its single snapshot does not recreate ratings for 1999–2003. In this sample the nominal year gap is six years for 1999, five for 2000, four for 2001, three for 2002, two for 2003, and one for 2004. It therefore cannot replace contemporaneous data for the full historical period or remove the need for other sources on earlier seasons.

The bounded archive search did not verify an accessible, complete original-game database for Winning Eleven 4 / ISS Pro Evolution, PES 3, or PES 4. Community PES 3 data was explicitly identified by a forum participant as coming from a World patch option file rather than the original PES 3 file. The same community project said PES 4 was complete, but extraction/source provenance was not established; a separate extraction discussion makes original PES 4 archive parsing plausible, not proven. A user-created ISS Pro database exists, but its extraction provenance was not stated. These do not safely fill the 1999–2004 chronology gap.

**Recommendation: do not build a formal PES→FIFA conversion adapter for ability v2 now.** Keep PES values in a source-specific raw schema with game/source/year provenance. The three OVR pairs are too few and mixed-sign, the detailed page taxonomies are not edition-proven, and many detailed skills are one-to-many or unmatched. Revisit only with verified original-edition data, a larger overlapping cohort, and per-edition definitions; do not fit or publish a conversion formula from this sample.

## Sources

- [PES Master PES 5 search](https://www.pesmaster.com/pes-5/search/) and [PES Master](https://www.pesmaster.com/).
- PES5 sample pages: [Vicente](https://www.pesmaster.com/vicente/pes-5/player/4037/), [Aimar](https://www.pesmaster.com/aimar/pes-5/player/986/), [Ayala](https://www.pesmaster.com/ayala/pes-5/player/968/).
- FIFA05 page diagnostics: [Vicente](https://fifaindex.com/players/111010-vicente/fifa05), [Pablo Aimar](https://fifaindex.com/players/10959-pablo-cesar-aimar/fifa05), [Roberto Ayala](https://fifaindex.com/es/jugadores/1131-roberto-fabian-ayala/fifa05).
- [FIFA Soccer 2005 contemporary guide](https://gamefaqs.gamespot.com/ps2/919617-fifa-soccer-2005/faqs/33456).
- [Community archive discussion for older PES/PSD](https://evoweb.uk/threads/most-complete-player-stats-database-for-older-pes-games-including-psd.94522/page-2); [PES4 extraction discussion](https://www.pesgaming.com/forums/threads/how-does-the-over-afs-file-work.12546/); [ISS Pro community player database](https://www.reddit.com/r/WEPES/comments/12fc8in/player_database_iss_pro_evolution_ps1/).
- [PlayersDB](https://playersdb.app/players) is a community identity-linking reference, not a PES ability source.
