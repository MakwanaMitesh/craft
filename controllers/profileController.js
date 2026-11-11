const User = require('../models/User');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/AppError');

exports.getProfile = catchAsync(async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('user/profile', { title: 'My profile', profileUser: user });
});

exports.updateProfile = catchAsync(async (req, res) => {
  const { name, phone, notifyOnCardOpened, notifyOnProposalYes } = req.body;
  const user = await User.findById(req.session.userId);

  user.name = name;
  user.phone = phone;
  user.notifyOnCardOpened = notifyOnCardOpened === 'on' || notifyOnCardOpened === 'true';
  user.notifyOnProposalYes = notifyOnProposalYes === 'on' || notifyOnProposalYes === 'true';
  await user.save();

  req.session.userName = user.name;
  req.session.flash = { type: 'success', message: 'Profile updated.' };
  res.redirect('/dashboard/profile');
});

exports.changePassword = catchAsync(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const user = await User.findById(req.session.userId).select('+password');

  if (!(await user.comparePassword(currentPassword))) {
    throw new AppError('Current password is incorrect.', 400);
  }
  if (newPassword !== confirmPassword) {
    throw new AppError('New passwords do not match.', 400);
  }

  user.password = newPassword;
  await user.save();

  req.session.flash = { type: 'success', message: 'Password changed.' };
  res.redirect('/dashboard/profile');
});
