---
id: operation15-authentication-manager-invoke
title: Invoke AuthenticationManager operation15 to trigger its built-in operation call behavior.
tags:
  - authentication
  - manager
  - api
  - method-call
  - java
  - console-output
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation15
sourceHash: bd47e41f326d66f6326bd12ba25669e205609bf8b016aa3cd7b3a0284135611b
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `AuthenticationManager` operation15 hook directly rather than adding a new helper.
Requires: An initialized `AuthenticationManager` instance in scope; no arguments are required.
API: public void operation15()

```java
authenticationManager.operation15();
```
