import assert from 'node:assert/strict';
import test from 'node:test';
import {splitTicktickNote,withPlanningDetails} from '../lib/ticktick-notes.ts';

test('planning details are legible and leave the original task note intact',()=>{
  const input='Telefonovať klientovi\nVziať podklady.';
  const content=withPlanningDetails(input,{role:'Podnikateľ',goal:'Získať klienta',quadrant:'II · dôležité, nenaliehavé',bigRock:true,rank:3});
  assert.equal(splitTicktickNote(content).notes,input);
  assert.match(content,/Rola: Podnikateľ\nCieľ: Získať klienta\nKvadrant: II · dôležité, nenaliehavé\nVeľký kameň: Áno\nPoradie: 3/);
});

test('changing a role replaces the same block, also if TickTick added text after it',()=>{
  const original=withPlanningDetails('Pôvodná poznámka',{role:'Otec'});
  const updated=withPlanningDetails(original+'\nDoplnil som v TickTicku.',{role:'Manžel'});
  assert.equal(updated.match(/\[Kompas – začiatok\]/g)?.length,1);
  assert.equal(splitTicktickNote(updated).notes,'Pôvodná poznámka\nDoplnil som v TickTicku.');
  assert.match(updated,/Rola: Manžel/);
  assert.doesNotMatch(updated,/Rola: Otec/);
});

test('note-only changes and clearing planning fields do not retain stale values',()=>{
  const content=withPlanningDetails(withPlanningDetails('',{role:'Otec',goal:'Výchova',bigRock:true}),{bigRock:false});
  const parsed=splitTicktickNote(content);
  assert.equal(parsed.notes,'');
  assert.equal(parsed.fields.Rola,undefined);
  assert.equal(parsed.fields.Cieľ,undefined);
  assert.equal(parsed.fields['Veľký kameň'],'Nie');
});
