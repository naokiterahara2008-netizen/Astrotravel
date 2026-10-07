import { lookbackGyr, radecToVec, DEG, AGE_UNIVERSE_GYR } from "../lib/math";

export type TypeCode =
  | "SA" | "SB" | "EL" | "S0" | "IR" | "PE" | "GC" | "OC" | "EM" | "RF" | "PN" | "SN"
  | "DK" | "SC" | "ST" | "QS" | "HZ" | "CL" | "BH" | "MW";

export const TYPE_LABEL: Record<TypeCode, string> = {
  SA: "渦巻銀河", SB: "棒渦巻銀河", EL: "楕円銀河", S0: "レンズ状銀河", IR: "不規則銀河", PE: "相互作用・特異銀河",
  GC: "球状星団", OC: "散開星団", EM: "散光星雲", RF: "反射星雲", PN: "惑星状星雲", SN: "超新星残骸",
  DK: "暗黒星雲", SC: "恒星雲", ST: "恒星", QS: "クエーサー / 活動銀河核", HZ: "宇宙初期の遠方銀河",
  CL: "銀河団", BH: "ブラックホール", MW: "天の川銀河",
};

export const TYPE_GROUP: Record<string, TypeCode[]> = {
  銀河: ["SA", "SB", "EL", "S0", "IR", "PE", "MW"],
  星団: ["GC", "OC", "SC"],
  星雲: ["EM", "RF", "PN", "SN", "DK"],
  恒星他: ["ST", "BH"],
  遠方: ["QS", "HZ", "CL"],
};

export interface CatObj {
  idx: number;
  id: string;
  name: string;
  type: TypeCode;
  ra: number;
  dec: number;
  distLy: number;
  z?: number;
  diamLy: number;
  radius: number;
  ratio: number;
  pa: number;
  wiki?: string;
  tags: Record<string, string>;
  pos: [number, number, number];
  lookbackYears: number;
  absMag: number;
  color: [number, number, number];
  angArcmin: number;
  group: "M" | "C" | "N" | "S" | "Q" | "H" | "O";
}

// id|名前|type|RA(h)|Dec(deg)|距離(光年 or zX)|大きさ(分角 AxB / L光年 / 恒星は絶対等級)|PA|Wikipedia|tags
const RAW = `
M1|かに星雲|SN|5.575|22.01|6500|6x4|0|Crab Nebula|vol
M2||GC|21.558|-0.82|37500|16||Messier 2|
M3||GC|13.703|28.38|33900|18||Messier 3|
M4||GC|16.393|-26.53|7200|36||Messier 4|
M5||GC|15.31|2.08|24500|23||Messier 5|
M6|バタフライ星団|OC|17.668|-32.25|1600|25||Butterfly Cluster|
M7|プトレマイオス星団|OC|17.898|-34.79|980|80||Ptolemy Cluster|
M8|干潟星雲|EM|18.063|-24.38|4100|90x40|0|Lagoon Nebula|cl
M9||GC|17.32|-18.52|25800|9||Messier 9|
M10||GC|16.952|-4.10|14300|20||Messier 10|
M11|ワイルドダック星団|OC|18.852|-6.27|6200|14||Wild Duck Cluster|n=2500
M12||GC|16.787|-1.95|16000|16||Messier 12|
M13|ヘルクレス座大球状星団|GC|16.695|36.46|22200|20||Messier 13|
M14||GC|17.627|-3.25|30300|11||Messier 14|
M15||GC|21.5|12.17|33600|18||Messier 15|
M16|わし星雲|EM|18.313|-13.79|7000|35|0|Eagle Nebula|cl
M17|オメガ星雲|EM|18.347|-16.18|5500|11|0|Omega Nebula|cl
M18||OC|18.332|-17.10|4900|9||Messier 18|
M19||GC|17.043|-26.27|28700|17||Messier 19|
M20|三裂星雲|EM|18.043|-23.03|5200|28|0|Trifid Nebula|cl
M21||OC|18.077|-22.50|4250|13||Messier 21|
M22||GC|18.607|-23.90|10600|32||Messier 22|
M23||OC|17.95|-19.02|2150|27||Messier 23|
M24|いて座の大星雲|SC|18.283|-18.55|10000|90x35|0|Sagittarius Star Cloud|
M25||OC|18.527|-19.12|2000|32||Messier 25|
M26||OC|18.753|-9.38|5000|15||Messier 26|
M27|あれい状星雲|PN|19.993|22.72|1360|8x6|0|Dumbbell Nebula|bipolar
M28||GC|18.408|-24.87|18000|11||Messier 28|
M29||OC|20.398|38.52|4000|7||Messier 29|
M30||GC|21.673|-23.18|27100|12||Messier 30|
M31|アンドロメダ銀河|SA|0.712|41.27|2537000|190x60|35|Andromeda Galaxy|arms=2,bulge=0.7,pitch=10,dust=1.4
M32||EL|0.712|40.87|2490000|8.7x6.5|170|Messier 32|
M33|さんかく座銀河|SA|1.565|30.66|2730000|71x42|23|Triangulum Galaxy|arms=2,pitch=22,bulge=0.1,hii=3
M34||OC|2.70|42.78|1500|35||Messier 34|
M35||OC|6.148|24.33|2800|28||Messier 35|
M36||OC|5.602|34.14|4100|12||Messier 36|
M37||OC|5.873|32.55|4500|24||Messier 37|
M38||OC|5.478|35.85|4200|21||Messier 38|
M39||OC|21.537|48.43|800|32||Messier 39|
M40|ウィンネッケ4|ST|12.373|58.08|510|3.0||Winnecke 4|c=ffe8c8
M41||OC|6.767|-20.76|2300|38||Messier 41|
M42|オリオン大星雲|EM|5.588|-5.39|1344|85x60|0|Orion Nebula|cl,trap
M43|ド・マラン星雲|EM|5.593|-5.27|1600|20x15|0|De Mairan's Nebula|
M44|プレセペ星団|OC|8.673|19.67|610|95|0|Beehive Cluster|
M45|すばる(プレアデス星団)|OC|3.783|24.12|444|110|0|Pleiades|refl
M46||OC|7.697|-14.81|5400|27||Messier 46|
M47||OC|7.61|-14.50|1600|30||Messier 47|
M48||OC|8.228|-5.75|2500|54||Messier 48|
M49||EL|12.497|8.00|56000000|10.2x8.3|65|Messier 49|gc
M50||OC|7.053|-8.37|3200|15||Messier 50|
M51|子持ち銀河|SA|13.498|47.20|23000000|11x7|163|Whirlpool Galaxy|arms=2,pitch=20,comp,bulge=0.3,hii=2
M52||OC|23.403|61.59|5000|13||Messier 52|
M53||GC|13.215|18.17|58000|13||Messier 53|
M54||GC|18.918|-30.48|87000|12||Messier 54|
M55||GC|19.667|-30.96|17600|19||Messier 55|
M56||GC|19.277|30.18|32900|7||Messier 56|
M57|環状星雲(リング星雲)|PN|18.893|33.03|2300|3.8x3.3|0|Ring Nebula|ring
M58||SB|12.628|11.82|62000000|6x5|... |Messier 58|arms=2,pitch=16
M59||EL|12.70|11.65|60000000|5x3.5|0|Messier 59|
M60||EL|12.728|11.55|55000000|7x6|0|Messier 60|gc
M61||SB|12.365|4.47|52500000|6.5x5.7|0|Messier 61|arms=3,pitch=18,hii=2
M62||GC|17.02|-30.11|22500|15||Messier 62|
M63|ひまわり銀河|SA|13.263|42.03|27000000|12.6x7.2|105|Sunflower Galaxy|flocc,bulge=0.4
M64|黒眼銀河|SA|12.945|21.68|17000000|10x5|115|Black Eye Galaxy|smooth,bulge=0.8,dust=2.5
M65||SB|11.315|13.09|35000000|10x3|174|Messier 65|bulge=0.6,arms=2,pitch=12
M66||SB|11.337|12.99|36000000|9x4|173|Messier 66|arms=2,pitch=16
M67||OC|8.857|11.80|2700|30||Messier 67|old,n=1500
M68||GC|12.658|-26.74|33600|11||Messier 68|
M69||GC|18.523|-32.35|29700|10||Messier 69|
M70||GC|18.72|-32.30|29400|8||Messier 70|
M71||GC|19.897|18.78|13000|7||Messier 71|
M72||GC|20.892|-12.54|55000|6||Messier 72|
M73||OC|20.983|-12.63|2500|2.8||Messier 73|n=40
M74||SA|1.612|15.78|32000000|10x9.5|25|Messier 74|arms=2,pitch=22,hii=2
M75||GC|20.102|-21.92|67500|7||Messier 75|
M76|小あれい状星雲|PN|1.705|51.58|2500|2.7x1.8|35|Little Dumbbell Nebula|bipolar
M77||SB|2.712|-0.01|47000000|7x6|... |Messier 77|bulge=0.7,arms=2,pitch=14
M78||RF|5.778|0.08|1600|8x6|0|Messier 78|
M79||GC|5.403|-24.52|41000|9||Messier 79|
M80||GC|16.283|-22.98|32600|10||Messier 80|
M81|ボーデの銀河|SA|9.926|69.07|12000000|27x14|157|Messier 81|arms=2,pitch=14,bulge=0.7
M82|葉巻銀河|PE|9.932|69.68|12000000|11x4.3|65|Messier 82|outflow
M83|南の回転花火銀河|SB|13.617|-29.87|15000000|13x12|45|Messier 83|arms=2,pitch=18,hii=2
M84||EL|12.418|12.89|60000000|6.5x5.6|0|Messier 84|
M85||S0|12.423|18.19|60000000|7.1x5.2|0|Messier 85|
M86||EL|12.437|12.95|52000000|12x9|0|Messier 86|
M87|おとめ座A (M87)|EL|12.514|12.39|53500000|8.3|0|Messier 87|jet=0.35,gc
M88||SA|12.533|14.42|47000000|7x4|130|Messier 88|arms=2,pitch=14
M89||EL|12.595|12.56|50000000|5||Messier 89|
M90||SB|12.613|13.16|58700000|9.5x4.4|150|Messier 90|arms=2,pitch=12,smooth
M91||SB|12.59|14.50|63000000|5.4x4.4|0|Messier 91|arms=2,pitch=18
M92||GC|17.285|43.14|26700|14||Messier 92|
M93||OC|7.743|-23.85|3600|22||Messier 93|
M94||SA|12.848|41.12|16000000|11x9|... |Messier 94|smooth,bulge=0.9
M95||SB|10.733|11.70|38000000|7.4x5|0|Messier 95|arms=2,pitch=10
M96||SA|10.78|11.82|31000000|7.6x5.2|0|Messier 96|arms=2,pitch=14
M97|ふくろう星雲|PN|11.247|55.02|2030|3.4|0|Owl Nebula|shell
M98||SB|12.23|14.90|44000000|9.8x2.8|155|Messier 98|arms=2
M99||SA|12.313|14.42|50000000|5.4|0|Messier 99|arms=3,pitch=20
M100||SA|12.382|15.82|55000000|7.4x6.3|0|Messier 100|arms=2,pitch=16,hii=2
M101|回転花火銀河|SA|14.053|54.35|20900000|29x27|0|Pinwheel Galaxy|arms=2,pitch=20,hii=3
M102|紡錘銀河(NGC 5866)|S0|15.108|55.76|50000000|6.6x3.2|128|Messier 102|dust=2
M103||OC|1.553|60.65|8500|6||Messier 103|
M104|ソンブレロ銀河|SA|12.666|-11.62|29300000|9x4|89|Sombrero Galaxy|smooth,bulge=1.2,dust=3
M105||EL|10.797|12.58|38000000|5.3x4.7|0|Messier 105|
M106||SB|12.316|47.30|23500000|19x8|150|Messier 106|arms=2,pitch=16
M107||GC|16.542|-13.05|20900|13||Messier 107|
M108||SB|11.192|55.67|46000000|8.7x2.2|80|Messier 108|smooth
M109||SB|11.96|53.37|83500000|7.6x4.3|77|Messier 109|arms=2,pitch=14
M110||EL|0.673|41.69|2690000|22x11|170|Messier 110|
C1||OC|0.74|85.24|5000|17||NGC 188|old,n=800
C2|ボウタイ星雲|PN|0.217|72.53|3500|0.6|0|NGC 40|shell
C3||SB|12.28|69.47|14000000|22x7|162|NGC 4236|arms=2,pitch=20
C4|アイリス星雲|RF|21.027|68.17|1300|18|0|NGC 7023|
C5||SA|3.78|68.10|11000000|21|0|IC 342|arms=2,pitch=22,dust=1.5,hii=2
C6|ネコの目星雲|PN|17.977|66.63|3300|0.4|0|Cat's Eye Nebula|shell
C7||SA|7.615|65.60|8800000|21x10|127|NGC 2403|arms=2,pitch=22,hii=2
C8||OC|1.49|63.30|7000|7||NGC 559|
C9|洞窟星雲|EM|22.95|62.62|2400|50|0|Cave Nebula|
C10||OC|1.767|61.23|8200|16||NGC 663|
C11|バブル星雲|EM|23.345|61.20|7100|15|0|Bubble Nebula|shell
C12|花火銀河|SA|20.58|60.15|22000000|11x10|0|NGC 6946|arms=3,pitch=22,hii=3
C13|ET星団|OC|1.318|58.28|7900|13||NGC 457|
C14|二重星団(h-χ)|OC|2.33|57.13|7500|60|0|Double Cluster|n=1500
C15|ブリンキング惑星状星雲|PN|19.747|50.52|3200|0.45|0|NGC 6826|shell
C16||OC|22.255|49.88|2800|21||NGC 7243|
C17||EL|0.553|48.51|2530000|13x8|25|NGC 147|
C18||EL|0.65|48.34|2050000|11x10|0|NGC 185|
C19|まゆ星雲|EM|21.89|47.27|3300|12|0|IC 5146|cl
C20|北アメリカ星雲|EM|20.98|44.33|2590|120x100|0|North America Nebula|
C21||IR|12.47|44.09|12500000|6x4|0|NGC 4449|
C22|ブルースノーボール星雲|PN|23.432|42.54|5600|0.5|0|NGC 7662|shell
C23||SA|2.377|42.35|30000000|13x3|22|NGC 891|smooth,bulge=0.7,dust=2.5
C24|ペルセウス座A|EL|3.33|41.51|237000000|2.2|0|NGC 1275|fil
C25|銀河間の放浪者|GC|7.635|38.88|275000|4.6||NGC 2419|
C26||SA|12.292|37.81|14000000|16x2|48|NGC 4244|smooth,bulge=0.2
C27|三日月星雲|EM|20.2|38.35|5000|20x10|0|Crescent Nebula|shell
C28||OC|1.963|37.78|1300|75||NGC 752|old
C29||SA|13.182|37.06|65000000|5.8x2.8|65|NGC 5005|smooth,bulge=0.6,dust=2
C30||SA|22.618|34.42|45000000|10.5x3.7|171|NGC 7331|arms=2,pitch=14,bulge=0.5,dust=1.5
C31|ほのおの星雲|EM|5.27|34.27|1500|37x19|0|IC 405|cl
C32|くじら銀河|SB|12.702|32.54|25000000|15x3|86|NGC 4631|smooth,bulge=0.1
C33|網状星雲(東)|SN|20.94|31.72|2400|60|0|Veil Nebula|arc
C34|網状星雲(西)|SN|20.762|30.71|2400|70|0|Veil Nebula|arc
C35||EL|13.002|27.98|320000000|2.9x1.9|0|NGC 4889|gc
C36||SA|12.6|27.96|29000000|11x5|150|NGC 4559|flocc
C37||OC|20.2|26.48|2000|20||NGC 6885|
C38|針の銀河|SA|12.605|25.99|40000000|16x2.8|135|NGC 4565|smooth,bulge=0.8,dust=2
C39|エスキモー星雲|PN|7.487|20.91|5000|0.8|0|Eskimo Nebula|shell
C40||S0|11.335|18.36|73000000|3x2|0|NGC 3626|
C41|ヒアデス星団|OC|4.45|15.87|153|330|0|Hyades (star cluster)|
C42||GC|21.025|16.19|135000|3.6||NGC 7006|
C43||SA|0.055|16.15|40000000|6x2.5|135|NGC 7814|smooth,bulge=1,dust=1.5
C44||SB|23.082|12.32|105000000|4x3|0|NGC 7479|arms=2,pitch=14
C45||SB|13.625|8.89|74000000|6x5|0|NGC 5248|arms=2,pitch=16
C46|ハッブル変光星雲|RF|6.653|8.73|2500|2|0|Hubble's Variable Nebula|
C47||GC|20.57|7.40|51000|7||NGC 6934|
C48||SA|9.172|7.04|67000000|4.3x3.3|0|NGC 2775|smooth,bulge=1
C49|ばら星雲|EM|6.538|5.03|5200|80|0|Rosette Nebula|hollow,cl
C50||OC|6.532|4.95|5200|24||NGC 2244|n=500
C51||IR|1.08|2.12|2380000|16|0|IC 1613|
C52||EL|12.81|-5.80|40000000|7x4.5|0|NGC 4697|
C53|紡錘銀河(NGC 3115)|S0|10.087|-7.72|32000000|8x3|43|Spindle Galaxy|
C54||OC|8.0|-10.77|10000|12||NGC 2506|old
C55|土星状星雲|PN|21.07|-11.36|5200|0.5|0|NGC 7009|shell
C56|ガイコツ星雲|PN|0.783|-11.87|1600|4|0|NGC 246|ring
C57|バーナードの銀河|IR|19.748|-14.80|1630000|15x14|0|NGC 6822|bar
C58||OC|7.297|-15.63|3700|13||NGC 2360|
C59|木星のゴースト|PN|10.413|-18.64|2000|0.4|0|NGC 3242|shell
C60|アンテナ銀河 (C60/61)|PE|12.032|-18.87|65000000|5x3|0|Antennae Galaxies|ant
C62||SB|0.785|-20.76|11100000|21x8|174|NGC 247|arms=2,bulge=0.1
C63|らせん星雲|PN|22.493|-20.84|650|16|0|Helix Nebula|ring
C64||OC|7.313|-24.95|4500|8||NGC 2362|
C65|ちょうこくしつ座銀河|SA|0.793|-25.29|11400000|27x7|52|Sculptor Galaxy|arms=2,pitch=16,bulge=0.4,dust=2,smooth
C66||GC|14.66|-26.54|113000|3||NGC 5694|
C67||SB|2.772|-30.27|45000000|9x6|0|NGC 1097|arms=2,pitch=10
C68||RF|19.032|-36.95|430|1|0|NGC 6729|
C69|バグ星雲|PN|17.228|-37.10|3800|3|0|NGC 6302|bipolar
C70||SA|0.915|-37.68|6500000|20x13|111|NGC 300|arms=3,pitch=22
C71||OC|7.872|-38.55|3700|27||NGC 2477|n=1200
C72||SB|0.252|-39.20|7000000|32x6|108|NGC 55|smooth,bulge=0.05
C73||GC|5.235|-40.05|39500|11||NGC 1851|
C74|エイトバースト星雲|PN|10.117|-40.44|2000|1.4|0|NGC 3132|shell
C75||OC|16.427|-40.66|1800|40||NGC 6124|
C76||OC|16.903|-41.83|5200|15||NGC 6231|n=1500
C77|ケンタウルス座A|EL|13.425|-43.02|12000000|25x20|35|Centaurus A|dust,jet=1.0
C78||GC|18.133|-43.71|22800|13||NGC 6541|
C79||GC|10.293|-46.41|16300|18||NGC 3201|
C80|ω星団|GC|13.447|-47.48|17000|36|0|Omega Centauri|big
C81||GC|17.425|-48.42|18600|7||NGC 6352|
C82||OC|16.69|-48.76|4300|15||NGC 6193|
C83||SB|13.09|-49.47|11700000|20x4|43|NGC 4945|smooth,dust=2
C84||GC|13.773|-51.37|35800|9||NGC 5286|
C85||OC|8.67|-53.04|480|50||IC 2391|
C86||GC|17.678|-53.67|7800|26||NGC 6397|
C87||GC|3.205|-55.22|53000|7||NGC 1261|
C88||OC|15.095|-55.60|3300|10||NGC 5823|
C89||OC|16.315|-57.90|3000|12||NGC 6087|
C90||PN|9.357|-58.31|5200|0.2|0|NGC 2867|shell
C91||OC|11.107|-58.75|1300|55||NGC 3532|n=1500
C92|カリーナ星雲|EM|10.752|-59.87|8500|120|0|Carina Nebula|cl
C93||GC|19.182|-59.98|13000|20||NGC 6752|
C94|宝石箱星団|OC|12.893|-60.35|6400|10|0|Jewel Box|
C95||OC|16.062|-60.50|2700|12||NGC 6025|
C96||OC|7.972|-60.87|1300|30||NGC 2516|n=1200
C97||OC|11.602|-61.62|5800|12||NGC 3766|
C98||OC|12.705|-62.99|4200|5||NGC 4609|
C99|コールサック|DK|12.88|-63.0|600|420x300|0|Coalsack Nebula|
C100||EM|11.633|-63.02|6500|75|0|IC 2944|cl
C101||SB|19.163|-63.86|30000000|20x13|15|NGC 6744|arms=2,pitch=16
C102|南のプレアデス|OC|10.72|-64.40|479|100|0|IC 2602|
C103|タランチュラ星雲|EM|5.645|-69.10|160000|40|0|Tarantula Nebula|cl
C104||GC|1.053|-70.85|28700|13||NGC 362|
C105||GC|12.993|-70.88|21200|14||NGC 4833|
C106|きょしちょう座47|GC|0.402|-72.08|14800|50|0|47 Tucanae|big
C107||GC|16.43|-72.20|45000|11||NGC 6101|
C108||GC|12.43|-72.66|15200|19||NGC 4372|
C109||PN|10.157|-80.86|5500|0.6|0|NGC 3195|shell
MW|天の川銀河|MW|17.761|-28.936|26670|L100000|0|Milky Way|
LMC|大マゼラン雲|IR|5.393|-69.756|163000|650x550|170|Large Magellanic Cloud|bar,hii=3
SMC|小マゼラン雲|IR|0.877|-72.8|200000|320x190|45|Small Magellanic Cloud|bar
NGC 1300||SB|3.328|-19.41|61000000|6.2x4|106|NGC 1300|bar,arms=2,pitch=12
NGC 1365||SB|3.561|-36.14|56000000|12x6|32|NGC 1365|bar,arms=2,pitch=14
NGC 1232||SA|3.163|-20.58|61000000|7.4x6.5|0|NGC 1232|arms=3,pitch=20
NGC 3628|ハンバーガー銀河|SA|11.337|13.59|35000000|15x3|103|NGC 3628|smooth,dust=2
NGC 2207|NGC 2207 / IC 2163|PE|6.272|-21.37|114000000|4.3x2.4|0|NGC 2207|ant
NGC 7318|ステファンの五つ子|CL|22.6|33.96|290000000|L500000|0|Stephan's Quintet|few=5
Cartwheel|カートホイール銀河|PE|0.629|-33.71|500000000|1.3|0|Cartwheel Galaxy|ring,inner
Hoag|ホーグの天体|PE|15.287|21.58|600000000|0.5|0|Hoag's Object|ring
NGC 4676|触角(マウス)銀河|PE|12.771|30.73|300000000|2|0|NGC 4676|ant
NGC 1316|フォルナックスA|EL|3.378|-37.21|62000000|12x8.5|50|NGC 1316|dust,jet=0.8
NGC 1566|スパニッシュ・ダンサー|SB|4.333|-54.94|40000000|8x6|0|NGC 1566|arms=2,pitch=18
NGC 5907|スプリンター銀河|SA|15.265|56.33|54000000|12x1.5|155|NGC 5907|smooth,dust=2
NGC 2024|燃える木星雲|EM|5.695|-1.85|1350|30|0|Flame Nebula|cl
Horsehead|馬頭星雲|DK|5.68|-2.46|1375|8x6|0|Horsehead Nebula|bg
NGC 1499|カリフォルニア星雲|EM|4.055|36.42|1000|145x40|0|California Nebula|
IC 1396|象の鼻星雲|EM|21.65|57.5|2400|170|0|IC 1396|cl
NGC 281|パックマン星雲|EM|0.88|56.62|9500|35|0|Pacman Nebula|cl
NGC 3603||EM|11.252|-61.26|20000|5|0|NGC 3603|cl
NGC 2264|コーン星雲・クリスマスツリー|EM|6.685|9.9|2500|20|0|Cone Nebula|cl
IC 1805|ハート星雲|EM|2.545|61.45|7500|60|0|Heart Nebula|cl
IC 1848|胎児星雲|EM|2.855|60.43|7500|60|0|Soul Nebula|
NGC 6357|戦争と平和星雲|EM|17.425|-34.2|5500|40|0|NGC 6357|cl
NGC 1977|ランニングマン星雲|EM|5.589|-4.82|1500|20|0|Running Man Nebula|
Vela SNR|ほ座超新星残骸|SN|8.567|-45.2|800|240|0|Vela Supernova Remnant|vol
NGC 6334|ネコの足星雲|EM|17.347|-35.8|5500|35|0|Cat's Paw Nebula|cl
Rho Oph|へびつかい座ρ星雲|RF|16.45|-24.6|460|240|0|Rho Ophiuchi cloud complex|
NGC 604||EM|1.575|30.78|2730000|1.9|0|NGC 604|cl
SgrA*|いて座A* (銀河中心ブラックホール)|BH|17.7611|-29.0078|26670|L4|0|Sagittarius A*|
CygX-1|はくちょう座X-1|BH|19.972|35.202|7200|L1|0|Cygnus X-1|
Virgo Cl|おとめ座銀河団|CL|12.43|12.7|54000000|L12000000|0|Virgo Cluster|
Fornax Cl|ろ座銀河団|CL|3.54|-35.45|62000000|L5000000|0|Fornax Cluster|
Perseus Cl|ペルセウス座銀河団|CL|3.33|41.5|240000000|L7000000|0|Perseus Cluster|
Coma Cl|かみのけ座銀河団|CL|12.998|27.98|321000000|L10000000|0|Coma Cluster|
Abell 1689||CL|13.1916|-1.34|z0.183|L3500000|0|Abell 1689|lens
Bullet Cl|弾丸銀河団|CL|6.975|-55.95|z0.296|L3500000|0|Bullet Cluster|lens
Abell 2744|パンドラ銀河団|CL|0.2385|-30.4|z0.308|L3500000|0|Abell 2744|lens
SMACS 0723|SMACS 0723 (JWST初画像)|CL|7.388|-73.45|z0.39|L3500000|0|SMACS J0723.3-7327|lens
El Gordo||CL|1.049|-49.25|z0.87|L4000000|0|El Gordo (galaxy cluster)|lens
3C 273|3C 273|QS|12.485|2.052|z0.158|L100000|0|3C 273|jet=3
3C 48||QS|1.628|33.16|z0.367|L60000|0|3C 48|
3C 279||QS|12.937|-5.789|z0.536|L50000|0|3C 279|jet=3
Ton 618|TON 618 (超大質量BH)|QS|12.473|31.477|z2.219|L40000|0|Ton 618|
APM 08279|APM 08279+5255|QS|8.528|52.75|z3.911|L30000|0|APM 08279+5255|
J1342+0928||QS|13.702|9.47|z7.54|L20000|0|ULAS J1342+0928|
J1120+0641||QS|11.334|6.69|z7.085|L20000|0|ULAS J1120+0641|
J1148+5251||QS|11.804|52.86|z6.419|L20000|0|SDSS J1148+5251|
J0313-1806||QS|3.229|-18.11|z7.64|L20000|0|J0313−1806|
J1007+2115||QS|10.12|21.25|z7.515|L20000|0|J1007+2115|
J0100+2802||QS|1.0|28.04|z6.327|L20000|0|SDSS J0100+2802|
J0529-4351||QS|5.488|-43.86|z3.962|L30000|0|J0529-4351|
Q0957+561|ふたご座クエーサー|QS|10.022|55.9|z1.413|L50000|0|Twin Quasar|
Q2237+030|アインシュタインの十字架|QS|22.675|3.36|z1.695|L40000|0|Einstein Cross|
H1413+117|クローバーリーフ|QS|14.263|11.5|z2.558|L40000|0|Cloverleaf quasar|
S5 0014+81||QS|0.285|81.585|z3.366|L40000|0|S5 0014+81|
PKS 1830-211||QS|18.561|-21.06|z2.507|L40000|0|PKS 1830-211|
OJ 287||QS|8.913|20.11|z0.306|L80000|0|OJ 287|jet=2
BL Lac|とかげ座BL|QS|22.045|42.28|z0.069|L100000|0|BL Lacertae|jet=1.5
Mrk 421||QS|11.074|38.21|z0.031|L100000|0|Markarian 421|jet=1.5
Cygnus A|はくちょう座A|QS|19.991|40.73|z0.056|L100000|0|Cygnus A|lobes
GN-z11|GN-z11 (z=10.6)|HZ|12.607|62.242|z10.603|L2400|0|GN-z11|
JADES-GS-z14-0|JADES-GS-z14-0 (z=14.3)|HZ|3.539|-27.856|z14.32|L1600|0|JADES-GS-z14-0|
MoM-z14|MoM-z14 (z=14.4)|HZ|10.006|2.274|z14.44|L800|0|MoM-z14|
JADES-GS-z13-0|JADES-GS-z13-0 (z=13.2)|HZ|3.543|-27.78|z13.2|L1600|0|JADES-GS-z13-0|
UNCOVER-z13||HZ|0.2385|-30.38|z13.08|L1500|0|UNCOVER-z13|
GHZ2|GHZ2 / GLASS-z12|HZ|0.2397|-30.35|z12.34|L1000|0|GLASS-z12|
HD1|HD1|HZ|10.031|2.503|z13.27|L1600|0|HD1 (galaxy)|
UDFj-39546284||HZ|3.5413|-27.79|z11.58|L2000|0|UDFj-39546284|
MACS0647-JD||HZ|6.799|70.25|z10.17|L1500|0|MACS0647-JD|
SPT0615-JD||HZ|6.26|-57.77|z10|L1500|0|SPT0615-JD|
A1689-zD1||HZ|13.1916|-1.34|z7.5|L3000|0|A1689-zD1|
EGSY8p7||HZ|14.3377|52.8|z8.68|L3000|0|EGSY8p7|
Earendel|エアレンデル (最遠の単一恒星)|ST|1.6258|-8.45|z6.2|-10||WHL0137-LZ|c=ffe0c0
SUN|太陽 (出発点)|ST|0|0|0|4.83||Sun|c=fff2d8
Sirius|シリウス|ST|6.752|-16.716|8.6|1.42||Sirius|c=cfe0ff
Canopus|カノープス|ST|6.399|-52.696|310|-5.71||Canopus|c=fff6e0
Arcturus|アークトゥルス|ST|14.261|19.182|37|-0.30||Arcturus|c=ffc890
Alpha Cen|ケンタウルス座α星|ST|14.66|-60.834|4.37|4.3||Alpha Centauri|c=fff0d0
Vega|ベガ|ST|18.616|38.784|25|0.58||Vega|c=d0e0ff
Capella|カペラ|ST|5.278|45.998|43|-0.48||Capella|c=ffeec0
Rigel|リゲル|ST|5.242|-8.202|860|-7.84||Rigel|c=bcd0ff
Procyon|プロキオン|ST|7.655|5.225|11.5|2.66||Procyon|c=fff4e0
Betelgeuse|ベテルギウス|ST|5.919|7.407|550|-5.85||Betelgeuse|c=ff9560
Achernar|アケルナル|ST|1.629|-57.237|139|-2.77||Achernar|c=c0d4ff
Altair|アルタイル|ST|19.846|8.868|17|2.2||Altair|c=f0f4ff
Aldebaran|アルデバラン|ST|4.599|16.509|65|-0.64||Aldebaran|c=ffb070
Antares|アンタレス|ST|16.49|-26.432|550|-5.28||Antares|c=ff8050
Spica|スピカ|ST|13.42|-11.161|250|-3.55||Spica|c=b8ccff
Pollux|ポルックス|ST|7.755|28.026|34|1.08||Pollux|c=ffc890
Fomalhaut|フォーマルハウト|ST|22.961|-29.622|25|1.74||Fomalhaut|c=e8f0ff
Deneb|デネブ|ST|20.69|45.28|2600|-8.38||Deneb|c=e8f0ff
Regulus|レグルス|ST|10.14|11.967|79|-0.57||Regulus|c=c0d0ff
Polaris|北極星 (ポラリス)|ST|2.53|89.264|433|-3.6||Polaris|c=fff4d8
Barnard|バーナード星|ST|17.963|4.693|5.96|13.2||Barnard's Star|c=ff7040
Proxima|プロキシマ・ケンタウリ|ST|14.495|-62.68|4.24|15.5||Proxima Centauri|c=ff5030
Eta Car|りゅうこつ座η星|ST|10.752|-59.684|7500|-10||Eta Carinae|c=ffe0c0
VY CMa|おおいぬ座VY星|ST|7.381|-25.767|3900|-9||VY Canis Majoris|c=ff6040
UY Sct|たて座UY星|ST|18.456|-12.47|9500|-7.5||UY Scuti|c=ff5030
`;

function hex(h: string): [number, number, number] {
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

function parse(): CatObj[] {
  const out: CatObj[] = [];
  const lines = RAW.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const f = line.split("|");
    const id = f[0];
    const type = f[2] as TypeCode;
    const ra = parseFloat(f[3]);
    const dec = parseFloat(f[4]);
    let distLy = 0;
    let z: number | undefined;
    if (f[5].startsWith("z")) {
      z = parseFloat(f[5].slice(1));
      distLy = lookbackGyr(z) * 1e9;
    } else distLy = parseFloat(f[5]);

    let diamLy = 0;
    let ratio = 1;
    let absMag = 5;
    const sz = f[6] || "10";
    let angArcmin = 0;
    if (type === "ST") {
      absMag = parseFloat(sz);
      diamLy = 0.2;
    } else if (sz.startsWith("L")) {
      diamLy = parseFloat(sz.slice(1));
    } else {
      const m = sz.split("x");
      const a = parseFloat(m[0]);
      if (m[1]) ratio = Math.min(1, parseFloat(m[1]) / a);
      angArcmin = a;
      diamLy = (a / 60) * DEG * distLy;
    }
    if (distLy > 0 && diamLy > 0) angArcmin = ((diamLy / distLy) / DEG) * 60;
    const pa = parseFloat(f[7]) || 0;
    const tags: Record<string, string> = {};
    (f[9] || "").split(",").forEach((t) => {
      if (!t) return;
      const [k, v] = t.split("=");
      tags[k] = v ?? "1";
    });
    let wiki = f[8] || undefined;
    if (!wiki && /^M\d+$/.test(id)) wiki = "Messier " + id.slice(1);
    if (type === "ST" && id === "M40") wiki = "Messier 40";
    let color: [number, number, number] = [1, 1, 1];
    if (tags.c) color = hex(tags.c);
    if (f[9] && type === "ST") {
      /* c= handled via tags */
    }
    // ST の c= は tags 末尾に入る。f[7] は PA 空欄を許容
    const group: CatObj["group"] =
      id.startsWith("M") && /^M\d+$/.test(id) ? "M" : /^C\d+$/.test(id) ? "C" :
      type === "ST" || type === "BH" ? "S" : type === "QS" || type === "CL" ? "Q" : type === "HZ" ? "H" :
      id === "MW" ? "O" : "N";

    const vec = radecToVec(ra, dec);
    const pos: [number, number, number] = [vec[0] * distLy, vec[1] * distLy, vec[2] * distLy];
    out.push({
      idx: out.length, id, name: f[1] || "", type, ra, dec, distLy, z, diamLy,
      radius: Math.max(diamLy / 2, 1e-4), ratio, pa, wiki, tags, pos,
      lookbackYears: distLy, absMag, color, angArcmin, group,
    });
  }
  return out;
}

export const CATALOG: CatObj[] = parse();
export const CAT_BY_ID: Record<string, CatObj> = Object.fromEntries(CATALOG.map((c) => [c.id, c]));
export { AGE_UNIVERSE_GYR };
