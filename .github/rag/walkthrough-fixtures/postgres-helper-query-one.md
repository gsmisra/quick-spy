---
id: postgres-query-one
title: Run a single parameterized query against Postgres and return one row
tags: [postgres, database, query, sql, api, helper]
automationMode: [api]
language: [java]
imports:
  java: ["com.acme.testkit.db.PostgresHelper"]
---

Use: Reach for this instead of opening a JDBC connection directly whenever an API test needs to read back exactly one row after a setup or verification step.
Requires: An already-open PostgresHelper connection (see its own constructor); the caller is responsible for closing it when done.
API: public Row queryOne(String sql, Object... params)

```java
Row row = postgresHelper.queryOne("SELECT * FROM orders WHERE id = ?", orderId);
```
