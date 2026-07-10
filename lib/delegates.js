// Ki kinek a nevében rögzíthet időt.
// Kulcs: a belépett kolléga; érték: akiknek a nevében rögzíthet.
export const DELEGATES = {
  "georgina.szucs@nestcom.hu": ["gabor.toth@nestcom.hu"]
};

export function delegatesOf(actorEmail){
  return DELEGATES[(actorEmail||"").toLowerCase()] || [];
}

export function canRecordFor(actorEmail, targetEmail){
  const a = (actorEmail||"").toLowerCase(), t = (targetEmail||"").toLowerCase();
  if(!t || a === t) return true;
  return delegatesOf(a).includes(t);
}
