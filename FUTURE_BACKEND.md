# Future Backend Migration Guide

This guide outlines the steps to transition the AIT Signs CRM from `localStorage` to a production-ready **Directus + PostgreSQL** backend.

## 1. Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed on Windows.
- [Node.js 20+](https://nodejs.org/) installed locally.

## 2. Docker Compose Setup
Create a `docker-compose.yml` in the project root:

```yaml
version: '3'
services:
  database:
    image: postgres:15
    volumes:
      - ./data/db:/var/lib/postgresql/data
    environment:
      POSTGRES_USER: 'directus'
      POSTGRES_PASSWORD: 'password'
      POSTGRES_DB: 'directus'

  directus:
    image: directus/directus:latest
    ports:
      - '8055:8055'
    volumes:
      - ./data/uploads:/directus/uploads
      - ./data/extensions:/directus/extensions
    depends_on:
      - database
    environment:
      KEY: 'some-random-key'
      SECRET: 'some-random-secret'
      DB_CLIENT: 'pg'
      DB_HOST: 'database'
      DB_PORT: '5432'
      DB_DATABASE: 'directus'
      DB_USER: 'directus'
      DB_PASSWORD: 'password'
      ADMIN_EMAIL: 'admin@aitsigns.com'
      ADMIN_PASSWORD: 'password'
```

## 3. Data Schema Migration
Once Directus is running at `http://localhost:8055`, you will need to create the following collections:
- `contacts`
- `work_orders`
- `financials`
- `tasks`
- `calendar_events`

Each should mirror the keys found in `src/lib/data.js`.

## 4. Frontend Integration
1. **Install Directus SDK**:
   ```bash
   npm install @directus/sdk
   ```

2. **Refactor `src/lib/store.js`**:
   Replace the `localStorage` logic with the Directus client:
   ```javascript
   import { createDirectus, rest, readItems } from '@directus/sdk';
   const client = createDirectus('http://localhost:8055').with(rest());
   ```

3. **Fetch Data**:
   Update the `useEffect` in `CRMProvider` to fetch from the API instead of `loadStorage()`.

## 5. CSV Import Strategy
When you have your Google Sheets ready:
1. Export them as **CSV**.
2. Use the Directus **Import** utility or a custom script in `src/lib/importer.js` to map the columns and push the records to the database.

---

### Need Help?
When you are ready to start this phase, let me know and I will help you write the specific `docker-compose` and migration scripts!
