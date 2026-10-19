// The app logs a lot through console.log (request notices, reminder progress).
// Silence it so the test report stays readable; console.error stays visible so
// unexpected server errors still show up when a test fails.
jest.spyOn(console, 'log').mockImplementation(() => {});
