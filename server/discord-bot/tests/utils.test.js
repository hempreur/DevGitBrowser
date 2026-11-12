'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {safeText, ticketTopic, parseTicket} = require('../utils');

test('neutralise les mentions publiques', () => {
  assert.doesNotMatch(safeText('Bonjour @everyone et @here'), /@everyone|@here/);
});
test('tickets: propriétaire, type et statut sont vérifiables au redémarrage', () => {
  const topic = ticketTopic('123456789012345678', 'beta');
  assert.deepEqual(parseTicket(topic), {ownerId:'123456789012345678', type:'beta', closed:false});
  assert.equal(parseTicket(ticketTopic('123456789012345678', 'beta', true)).closed,true);
  assert.equal(parseTicket('autre message'),null);
  assert.throws(()=>ticketTopic('invalide','bug'));
});
