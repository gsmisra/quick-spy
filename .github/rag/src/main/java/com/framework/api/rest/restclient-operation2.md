---
id: operation2-restclient-invoke
title: Invoke the RestClient `operation2` method.
tags:
  - restclient
  - api
  - method-call
  - java
  - smoke
  - internal-library
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation2
sourceHash: 4b4a3f7dcc6f6bd7a9e19449a213906bf8692e6062b7718f348d36621aac5fa4
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to trigger `operation2` on an existing `RestClient` instance instead of adding new helper code.
Requires: An initialized `RestClient` object in scope.
API: public void operation2()

```java
restClient.operation2();
```
