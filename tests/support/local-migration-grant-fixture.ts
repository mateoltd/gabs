import { publishLocalPackage } from "./local-package-fixture";
export async function migrationGrantFixture() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const providerName = `Reference provider ${suffix}`,
    consumerName = `Reference consumer ${suffix}`;
  const provider = await publishLocalPackage({ name: providerName });
  const consumer = await publishLocalPackage({
    name: consumerName,
    dependencies: { [provider.pkg.module_id]: "^1" },
    dependencyPackages: [provider.pkg],
  });
  const targetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const localStorage = {
    version: 2,
    compatible: { minimum: 2, maximum: 2 },
    migrations: { link: { from: 1, to: 2 } },
  };
  const upgrade = async () => {
    const nextProvider = await publishLocalPackage({
      id: provider.pkg.module_id,
      name: providerName,
      version: "1.1.0",
      localStorage,
      migrationOnly: true,
      transform: (file, source) =>
        file === "module.ts"
          ? source.replace(
              "},{title:'Notes'",
              ",name:Type.Optional(field.text())},{title:'Notes'",
            )
          : source
              .replace(
                "let after;",
                `await ctx.resource('items').create({text:'New migration target',name:'New migration target'},'${targetId}');let after;`,
              )
              .replace(
                "{text:row.data.text??row.data.body}",
                "{text:row.data.text??row.data.body,name:row.data.name??row.data.text}",
              ),
    });
    const nextConsumer = await publishLocalPackage({
      id: consumer.pkg.module_id,
      name: consumerName,
      version: "1.1.0",
      localStorage,
      migrationOnly: true,
      dependencies: { [provider.pkg.module_id]: "^1.1" },
      dependencyPackages: [nextProvider.pkg],
      transform: (file, source) =>
        file === "module.ts"
          ? source.replace(
              "},{title:'Notes'",
              `,target:Type.Optional(field.reference('${provider.pkg.module_id}','items'))},{title:'Notes'`,
            )
          : source
              .replace(
                "let after;",
                `if(ctx.configuration.prefix==='slow')await new Promise(resolve=>setTimeout(resolve,1500));let after;`,
              )
              .replace(
                "{text:row.data.text??row.data.body}",
                `{text:row.data.text??row.data.body,target:'${targetId}'}`,
              ),
    });
    return { provider: nextProvider, consumer: nextConsumer };
  };
  return { provider, consumer, providerName, consumerName, targetId, upgrade };
}
