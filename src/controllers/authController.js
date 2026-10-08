const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { ApiError } = require('../utils/errors');
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      !email.trim() ||
      !password ||
      email.length > 254 ||
      password.length > 1024
    )
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'email and password are required'
      );
    const user = await User.findOne({ email: email.trim().toLowerCase() });
    if (
      !user ||
      !user.active ||
      !(await bcrypt.compare(password, user.passwordHash))
    )
      throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid email or password');
    const token = jwt.sign({ role: user.role }, process.env.JWT_SECRET, {
      subject: String(user._id),
      expiresIn: process.env.JWT_EXPIRES_IN || '8h'
    });
    res.set('Cache-Control', 'no-store');
    res.json({
      token,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      user: {
        id: user._id,
        name: user.name,
        role: user.role,
        jurisdictionType: user.jurisdictionType
      }
    });
  } catch (e) {
    next(e);
  }
};
