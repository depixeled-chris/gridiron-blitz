# Pre-baked POC Rosters

> Synthesized design — Gridiron Blitz. Reconciled from all system specs in `systems/`.

## Two pre-baked POC teams (deterministic)

Both ~78 OVR but **distinct identities**, chosen so headless tests exercise the full outcome spectrum: HOME = balanced/grind, AWAY = boom-bust (elite EDGE + elite RB, weaker OL/secondary). On an even drive most reps grind; the designed mismatches (AWAY EDGE vs HOME RT, AWAY RB vs HOME LB, HOME slot WR vs AWAY CB2) reliably throw blow-bys/pancakes.

Ratings only list contest-relevant fields; unlisted default to **70**.

```json
{
  "HOME_Anvil": {
    "identity": "balanced, strong interior OL, sure-tackling, average athletes",
    "QB7":   {"SPD":72,"THP":84,"ACS":86,"ACM":80,"ACD":74,"PLZ":82,"AWR":82,"AGG":-0.2},
    "RB28":  {"SPD":88,"ACC":86,"AGI":82,"CAR":84,"TRK":74,"ELU":80,"BCV":82,"JKM":80,"SPM":74,"SFA":70,"BTK":78},
    "WR80":  {"SPD":90,"ACC":88,"AGI":84,"CTH":84,"CIT":78,"SPC":76,"RLS":82,"RRS":84,"RRM":84,"RRD":82},
    "WR88":  {"SPD":84,"ACC":82,"AGI":80,"CTH":86,"CIT":84,"SPC":74,"RLS":78,"RRS":86,"RRM":82,"RRD":74},
    "TE84":  {"SPD":78,"AGI":72,"CTH":82,"CIT":84,"SPC":72,"RLS":70,"RRS":80,"RRM":78,"RRD":68,"RBK":80,"IBL":76},
    "LT73":  {"PBK":82,"PBP":80,"PBF":80,"RBK":80,"IBL":74,"STR":82,"WT":78,"AWR":80},
    "LG66":  {"PBK":84,"PBP":86,"PBF":78,"RBK":86,"STR":88,"WT":84},
    "CEN55": {"PBK":83,"PBP":84,"PBF":80,"RBK":84,"STR":84,"WT":80,"AWR":84},
    "RG67":  {"PBK":82,"PBP":84,"PBF":76,"RBK":84,"STR":86,"WT":84},
    "RT76":  {"PBK":74,"PBP":74,"PBF":72,"RBK":76,"STR":78,"WT":78},
    "FB44":  {"RBK":72,"IBL":74,"STR":82,"WT":80},
    "EDGE91":{"SPD":84,"PMV":80,"FMV":82,"BSH":82,"PWR":80,"STR":82,"BSH_edge":true,"TAK":78,"HIT":80,"PUR":80,"PRC":78},
    "EDGE99":{"SPD":80,"PMV":82,"FMV":76,"BSH":78,"PWR":84,"STR":86,"TAK":80,"HIT":82,"PUR":78,"PRC":76},
    "DT93":  {"PMV":82,"FMV":68,"BSH":80,"PWR":86,"STR":88,"TAK":78,"HIT":78,"PUR":68,"PRC":74},
    "DT97":  {"PMV":80,"FMV":66,"BSH":78,"PWR":84,"STR":86,"TAK":76,"HIT":76,"PUR":66,"PRC":72},
    "MLB52": {"SPD":84,"TAK":86,"HIT":84,"BSH":80,"PRC":86,"PUR":84,"ZCV":78,"MCV":72,"STR":80},
    "OLB56": {"SPD":86,"TAK":82,"HIT":80,"BSH":76,"PRC":80,"PUR":84,"ZCV":76,"MCV":74},
    "CB24":  {"SPD":90,"ACC":88,"AGI":86,"MCV":84,"ZCV":80,"PRS":80,"INT":78,"JMP":80,"TAK":72,"PRC":80,"PUR":84},
    "CB22":  {"SPD":88,"ACC":86,"AGI":82,"MCV":80,"ZCV":82,"PRS":76,"INT":74,"JMP":76,"TAK":70,"PRC":78},
    "FS31":  {"SPD":88,"MCV":76,"ZCV":86,"PRS":66,"INT":82,"JMP":80,"TAK":78,"HIT":82,"PRC":84,"PUR":86},
    "SS33":  {"SPD":84,"MCV":78,"ZCV":82,"PRS":74,"INT":74,"TAK":84,"HIT":86,"PRC":80,"PUR":82,"STR":80}
  },
  "AWAY_Bolt": {
    "identity": "boom-bust: elite EDGE rush + elite RB, weaker OL edges + CB2 (exploitable)",
    "QB7":   {"SPD":86,"THP":90,"ACS":80,"ACM":78,"ACD":82,"PLZ":72,"AWR":74,"RUN":84,"AGG":0.4},
    "RB28":  {"SPD":94,"ACC":92,"AGI":90,"CAR":78,"TRK":86,"ELU":92,"BCV":86,"JKM":90,"SPM":86,"SFA":80,"BTK":90},
    "WR80":  {"SPD":94,"ACC":90,"AGI":86,"CTH":80,"CIT":72,"SPC":82,"RLS":84,"RRS":80,"RRM":80,"RRD":86},
    "WR88":  {"SPD":82,"ACC":80,"AGI":78,"CTH":82,"CIT":80,"SPC":72,"RLS":74,"RRS":82,"RRM":80,"RRD":72},
    "TE84":  {"SPD":80,"AGI":74,"CTH":78,"CIT":76,"SPC":74,"RLS":72,"RRS":76,"RRM":76,"RRD":72,"RBK":72,"IBL":70},
    "LT73":  {"PBK":76,"PBP":74,"PBF":76,"RBK":74,"STR":76,"WT":74},
    "LG66":  {"PBK":78,"PBP":80,"PBF":74,"RBK":80,"STR":82,"WT":82},
    "CEN55": {"PBK":80,"PBP":80,"PBF":78,"RBK":80,"STR":80,"WT":78,"AWR":78},
    "RG67":  {"PBK":76,"PBP":78,"PBF":72,"RBK":78,"STR":80,"WT":82},
    "RT76":  {"PBK":70,"PBP":70,"PBF":68,"RBK":72,"STR":74,"WT":76},
    "FB44":  {"RBK":68,"IBL":70,"STR":78,"WT":78},
    "EDGE91":{"SPD":92,"PMV":86,"FMV":94,"BSH":88,"PWR":82,"STR":80,"BSH_edge":true,"TAK":80,"HIT":84,"PUR":86,"PRC":82},
    "EDGE99":{"SPD":88,"PMV":90,"FMV":84,"BSH":86,"PWR":88,"STR":86,"TAK":82,"HIT":86,"PUR":82,"PRC":78},
    "DT93":  {"PMV":78,"FMV":66,"BSH":74,"PWR":80,"STR":82,"TAK":74,"HIT":74,"PUR":66,"PRC":70},
    "DT97":  {"PMV":76,"FMV":64,"BSH":72,"PWR":78,"STR":80,"TAK":72,"HIT":72,"PUR":64,"PRC":68},
    "MLB52": {"SPD":86,"TAK":80,"HIT":82,"BSH":74,"PRC":76,"PUR":82,"ZCV":72,"MCV":70,"STR":76},
    "OLB56": {"SPD":88,"TAK":78,"HIT":80,"BSH":72,"PRC":74,"PUR":86,"ZCV":72,"MCV":72},
    "CB24":  {"SPD":92,"ACC":90,"AGI":88,"MCV":82,"ZCV":76,"PRS":82,"INT":76,"JMP":82,"TAK":68,"PRC":76,"PUR":84},
    "CB22":  {"SPD":86,"ACC":82,"AGI":78,"MCV":68,"ZCV":70,"PRS":64,"INT":66,"JMP":70,"TAK":66,"PRC":68},
    "FS31":  {"SPD":90,"MCV":74,"ZCV":80,"INT":78,"JMP":82,"TAK":74,"HIT":78,"PRC":78,"PUR":88},
    "SS33":  {"SPD":86,"MCV":72,"ZCV":76,"PRS":72,"INT":70,"TAK":80,"HIT":88,"PRC":74,"PUR":82,"STR":82}
  }
}
```

**Designed test mismatches** (delta in pts, fed to kernel):
- AWAY EDGE91 FMV 94 vs HOME RT76 PBF 72 -> finesse rush delta ~+22 (frequent blow-by/super-win).
- AWAY RB28 (ELU 92/BTK 90) vs HOME OLB56 TAK 82 -> juke break delta ~+8 (broken tackles, not auto).
- HOME WR80 (RRM 84) vs AWAY CB22 MCV 68 -> separation delta ~+16 (open mediums).
- HOME LG66 RBK 86 vs AWAY DT93 BSH 74 -> run-block delta ~-12 (drive/pancake interior).
These give every kernel branch (extreme-up, near-even, extreme-down) deterministic coverage.
