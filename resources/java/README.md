# Bundled offline Maven repository (`m2repo/`)

Ships REST Assured, JUnit Jupiter, SLF4J, and Cucumber's own jars — pre-resolved
and vendored here — so **"Verify & Fix Code" for API Automation mode (Java)**
never has to reach Maven Central to compile/run the AI-generated code. This is
exactly what a bank/enterprise machine with restricted or no internet egress
needs.

`src/execution/testExecutor.ts` passes `-Dmaven.repo.local=<this folder>` to
every `mvn` invocation when it's present. That's a local-repo **location**
override, not `-o`/offline mode — Maven still reaches its normally configured
repositories for anything not already cached here (Playwright Java's own jars
in UI mode, deliberately never bundled — out of scope, the user is expected to
already have a real browser + Playwright available). If this folder is
missing (e.g. a fresh dev checkout before running the prep step below), the
flag is simply omitted and Maven falls back to its own default local repo —
no behavior change.

## Regenerating it

Only needed when the dependency versions in `testExecutor.ts`'s
`javaPomXml()` change (`REST_ASSURED_VERSION`, `JUNIT_JUPITER_VERSION`,
`SLF4J_VERSION`, `CUCUMBER_VERSION`, `JUNIT_PLATFORM_SUITE_VERSION`) or the
Maven/JDK toolchain used to build changes. From a machine with normal
internet access:

```bash
mkdir -p /tmp/softplay-javaprep && cd /tmp/softplay-javaprep
cat > pom.xml <<'EOF'
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.softplay.runner</groupId>
  <artifactId>softplay-runner</artifactId>
  <version>1.0.0</version>
  <properties>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency><groupId>io.rest-assured</groupId><artifactId>rest-assured</artifactId><version>5.5.0</version></dependency>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.11.0</version><scope>test</scope></dependency>
    <dependency><groupId>org.slf4j</groupId><artifactId>slf4j-simple</artifactId><version>2.0.13</version></dependency>
    <dependency><groupId>io.cucumber</groupId><artifactId>cucumber-java</artifactId><version>7.18.0</version></dependency>
    <dependency><groupId>io.cucumber</groupId><artifactId>cucumber-junit-platform-engine</artifactId><version>7.18.0</version></dependency>
    <dependency><groupId>org.junit.platform</groupId><artifactId>junit-platform-suite</artifactId><version>1.11.0</version></dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.2.5</version></plugin>
    </plugins>
  </build>
</project>
EOF
# 1) Resolve every dependency jar into the bundled repo.
mvn -q -B -Dmaven.repo.local=<repo>/resources/java/m2repo dependency:go-offline
# 2) Also pull in the Maven *plugin* jars the build lifecycle itself needs
#    (compiler/resources/surefire) by actually compiling+running one real
#    test file against this same repo — dependency:go-offline alone does
#    not resolve plugin dependencies.
mkdir -p src/test/java && cat > src/test/java/SampleApiTest.java <<'EOF'
import static io.restassured.RestAssured.given;
import org.junit.jupiter.api.Test;
public class SampleApiTest {
  @Test public void getRequestSucceeds() { given().when().get("https://httpbin.org/get").then().statusCode(200); }
}
EOF
mvn -q -B -Dmaven.repo.local=<repo>/resources/java/m2repo test
# 3) Verify it's now fully self-contained:
mvn -q -B -o -Dmaven.repo.local=<repo>/resources/java/m2repo test
```

Confirm no `*.lastUpdated` files were left behind (`find resources/java/m2repo
-name "*.lastUpdated"` — a non-empty result means a download failed) before
committing.
