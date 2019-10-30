let mongoose = require('mongoose');

// Cube schema
let deckSchema = mongoose.Schema({
  cards: [
    []
  ],
  owner: String,
  cube: String,
  date: Date,
  name: String,
  bots: [
    []
  ],
  playerdeck: [
    []
  ],
  playersideboard: [
    []
  ],
  cols: Number
});

deckSchema.virtual('cubeCube', {
  ref: 'Cube',
  localField: 'cube',
  foreignField: '_id'
});

deckSchema.virtual('ownerUser', {
  ref: 'User',
  localField: 'owner',
  foreignField: '_id'
});

let Deck = module.exports = mongoose.model('Deck', deckSchema)