---
id: login-page-login
title: Log a user into the application via the login page's username/password form
tags: [login, authentication, ui, page object, session]
automationMode: [ui]
language: [java]
imports:
  java: ["com.acme.testkit.pages.LoginPage"]
---

Use: Reach for this at the start of any UI scenario that needs an authenticated session, instead of re-typing the login form's own selectors.
Requires: A Playwright Page already navigated to the login screen (see LoginPage's own constructor, which takes that Page).
API: public void login(String username, String password)

```java
loginPage.login("test.user@example.com", "Password123!");
```
