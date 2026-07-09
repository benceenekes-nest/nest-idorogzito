// lista_id -> Ügyfél (ClickUp space) megfeleltetés
export const CLIENTS = {
  "901208308344":"NEST Media","901208309930":"Házak","901202639166":"NEST Group",
  "211572212":"BUSINESS & Others – Bence","205740748":"NEST BELSŐ","901200774392":"Akku Info",
  "900801390638":"BAMO","901200632141":"Borsodchem","205785384":"EFOTT – HÖOK",
  "900801700188":"EVE Power","205785675":"Futureal/Cordia/HelloParks","211507351":"Investify/Trustify",
  "211619425":"Visual Europe Group","181797311":"NEST – Office","211520166":"NEST Board",
  "211577273":"New Business","900800210354":"NEST – Op. vezetés","900800921422":"Gór Csaba – T. Gábor",
  "901200905030":"Educatio","901201273686":"Nest díjak, kirakat","901201915393":"F Mobilitás",
  "901202013228":"BYD","901203708969":"INPARK","901204707820":"UniNext / PTE",
  "901206599132":"PractiWork","901206530296":"Hybern / Camel Group","901207189812":"Sinoma",
  "901207929747":"KunlunChem","901210517769":"Zenthe Ferenc Színház","901211045864":"CATL",
  "901210683604":"Granulines","901213224678":"VSG Vulcan Shield Global","901213898067":"SK On",
  "901214599695":"BlockBen","901216137872":"Samsung SDI","901216340483":"MGFÜ","901218333809":"Koch"
};

export const ACTIVITIES = [
  "Adminisztráció",
  "Belső képzés",
  "Egyeztetés - alvállalkozóval",
  "Egyeztetés - belső",
  "Egyeztetés - ügyféllel",
  "Közbeszerzés / ajánlat",
  "Kreatív / design",
  "Kutatás / adatgyűjtés",
  "Médiatervezés / -vásárlás",
  "Médiatréning / moderálás",
  "PPC / performance",
  "Prezentációkészítés",
  "Rendezvényszervezés",
  "Riport / elemzés",
  "Sajtókapcsolat / monitoring",
  "Sajtóközlemény",
  "Social media / tartalom",
  "Stratégia / kampánytervezés",
  "Szövegírás (kiadvány, beszéd, Q&A, egyéb)",
  "Utazás",
  "Videó / gyártás",
  "Vezetői / HR / szervezetfejlesztés",
  "Web / fejlesztés",
  "Egyéb",
];

export function clientOf(task){
  const lid = task && task.list && task.list.id;
  return (lid && CLIENTS[lid]) || (task && task.list && task.list.name) || "—";
}
