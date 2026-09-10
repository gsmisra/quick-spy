---
id: request-specification-factory-execute
title: Invokes the RequestSpecificationFactory execute method to run its built-in execution step.
tags:
  - api
  - restassured
  - execute
  - factory
  - request-specification
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.restassured.RequestSpecificationFactory
sourcePath: src/main/java/com/framework/api/restassured/RequestSpecificationFactory.java#execute
sourceHash: 91eb755fdbb3bef78630f5f4407f172932005866c72561a08fded6098bcc71f0
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to trigger the `RequestSpecificationFactory` execution step directly instead of reimplementing class-specific behavior.
Requires: A `RequestSpecificationFactory` instance.
API: public void execute()

```java
new RequestSpecificationFactory().execute();
```
