---
id: restclient-operation16-invocation
title: Invoke RestClient operation16 when a test needs to trigger this client operation directly.
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
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation16
sourceHash: 466dcd60be06aafbfc59004129509ffecfa370a931cf4c75d06bfa2f369d8b6b
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when test code needs to call the existing `RestClient` capability named `operation16` instead of creating a new helper path.
Requires: A constructed `RestClient` instance in scope.
API: public void operation16()

```java
new RestClient().operation16();
```
