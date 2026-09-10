---
id: restclient-operation5-call
title: Call RestClient operation5 to execute its predefined API-side action.
tags:
  - restclient
  - api
  - method-call
  - java
  - operation5
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation5
sourceHash: 9ceab13ec16d151019940aa160f1d07f4b606a7a92c39519ddb95809826a5fd1
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `RestClient` `operation5` behavior directly instead of adding a new helper.
Requires: A `RestClient` instance is already created and available to the caller.
API: public void operation5()

```java
restClient.operation5();
```
