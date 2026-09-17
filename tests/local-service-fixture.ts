import { publishLocalPackage } from "./local-package-fixture";
export async function localServiceFixture() {
  const suffix = crypto.randomUUID().slice(0, 8),
    providerId = `local-service-provider-${suffix}`,
    consumerId = `local-service-consumer-${suffix}`;
  const providerName = `Notebook service ${suffix}`,
    consumerName = `Linked notes ${suffix}`;
  const publishProvider = (version = "1.0.0") =>
    publishLocalPackage({
      id: providerId,
      name: providerName,
      version,
      transform: (file, source) =>
        file === "module.ts"
          ? source.replace(
              "policy:'local',permission:",
              "policy:'local',public:true,permission:",
            )
          : source,
    });
  const provider = await publishProvider();
  const publishConsumer = (version = "1.0.0") =>
    publishLocalPackage({
      id: consumerId,
      name: consumerName,
      version,
      dependencies: { [providerId]: "^1" },
      dependencyPackages: [provider.pkg],
      dependencySources: { [providerId]: provider.moduleSource },
      transform: (file, source) =>
        file === "module.ts"
          ? `import provider from './dependencies/${providerId}/module';\n` +
            source
              .replace("operation,Type", "operation,serviceReference,Type")
              .replace(
                "resources:{items:",
                "services:{append:serviceReference(provider,'capture')},resources:{items:",
              )
          : `import {defineLocalModule} from '@suite/module-sdk/local';import module from './module';export default defineLocalModule(module)({async capture(ctx,input){await ctx.resource('items').create({text:'Consumer: '+input.text});const id=await ctx.service('append',{text:input.text,delayMs:input.delayMs});if(input.reject)ctx.reject({reason:'blocked'});return id;}});`,
    });
  const consumer = await publishConsumer();
  return {
    provider,
    consumer,
    providerName,
    consumerName,
    publishProvider,
    publishConsumer,
  };
}
