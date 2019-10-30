const mongoose = require('mongoose');

// User schema
const UserSchema = mongoose.Schema({
  username: {
    type: String,
    required: true
  },
  username_lower: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  confirmed: {
    type: String,
    required: true
  },
  about: {
    type: String,
    required: false
  },
  hide_tag_colors: {
    type: Boolean,
    default: false
  },
  edit_token: String
});

UserSchema.virtual('profileUrl').get(function() {
  return `/user/view/${this._id}`;
});

UserSchema.set('toJSON', { virtuals: true });

const User = module.exports = mongoose.model('User', UserSchema);