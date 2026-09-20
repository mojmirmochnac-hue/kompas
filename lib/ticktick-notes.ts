const begin='[Kompas – začiatok]';
const end='[Kompas – koniec]';
const blockPattern=/(?:^|\n)\[Kompas – začiatok\]\r?\n[\s\S]*?\r?\n\[Kompas – koniec\](?:\r?\n)?/g;

export type PlanningDetails={role?:string;goal?:string;quadrant?:string;bigRock?:boolean;rank?:number};

export function splitTicktickNote(content:string){
  const match=content.match(blockPattern);
  const notes=content.replace(blockPattern,'').trimEnd();
  const fields:Record<string,string>={};
  if(match?.length){
    for(const line of match[match.length-1].split('\n')){
      const colon=line.indexOf(':');
      if(colon>=0)fields[line.slice(0,colon).trim()]=line.slice(colon+1).trim();
    }
  }
  return {notes,fields,hasPlanningBlock:!!match?.length};
}

export function withPlanningDetails(content:string,details:PlanningDetails){
  const notes=splitTicktickNote(content).notes;
  const label=(value:string)=>value.replace(/[\r\n]+/g,' ').trim();
  const lines=[
    begin,
    ...(details.role?[`Rola: ${label(details.role)}`]:[]),
    ...(details.goal?[`Cieľ: ${label(details.goal)}`]:[]),
    `Kvadrant: ${label(details.quadrant||'II · dôležité, nenaliehavé')}`,
    `Veľký kameň: ${details.bigRock?'Áno':'Nie'}`,
    `Poradie: ${details.rank||1}`,
    end,
  ];
  return (notes?notes+'\n\n':'')+lines.join('\n');
}
