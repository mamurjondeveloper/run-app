// Changes here are picked up by .github/workflows/deploy.yml on push to main.
// JWT_SECRET / DATABASE_URL are intentionally NOT set here — they must live
// only in backend/.env on the server (git-ignored) so real secrets never end
// up committed to this file, which is tracked in git.
module.exports = {
  apps: [
    {
      name: 'run-backend',
      cwd: './backend',
      script: 'dist/src/main.js',
      env: {
        PORT: 4006,
        NODE_ENV: 'production',
      },
    },
    {
      name: 'run-frontend',
      cwd: './frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3006',
      env: {
        PORT: 3006,
        NODE_ENV: 'production',
      },
    },
  ],
};
