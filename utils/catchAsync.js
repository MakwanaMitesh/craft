// Wraps an async controller so rejected promises reach the central error handler.
module.exports = function catchAsync(fn) {
  return function wrapped(req, res, next) {
    fn(req, res, next).catch(next);
  };
};
