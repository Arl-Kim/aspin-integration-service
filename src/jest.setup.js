// Set test timeout
jest.setTimeout(30000);

// Global teardown
afterAll(async () => {
  // Allow any pending promises to resolve
  await new Promise((resolve) => setTimeout(resolve, 500));
});
