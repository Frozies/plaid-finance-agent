// Global test setup — runs before each test file
// Provides required environment variables so config.ts doesn't call process.exit

process.env['PLAID_CLIENT_ID'] = 'test_client_id';
process.env['PLAID_SECRET'] = 'test_secret';
process.env['PLAID_ENV'] = 'sandbox';
process.env['ENCRYPTION_KEY'] = '924817e1359e2312519ba80157fda099161da663af5cf2a27ba5dedd64472424';
process.env['BEARER_TOKEN'] = '5b75fe7acd7a6e88acef24deb508d937a735670fec125ee9a5dd56e7a914a96e';
process.env['PORT'] = '0'; // Random port for tests
process.env['HOST'] = '127.0.0.1';
process.env['LOG_LEVEL'] = 'silent';
