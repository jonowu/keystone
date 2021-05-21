import { ProviderName, testConfig } from '@keystone-next/test-utils-legacy';
import { text } from '@keystone-next/fields';
import { createSchema, list } from '@keystone-next/keystone/schema';
import { multiAdapterRunners, setupFromConfig } from '@keystone-next/test-utils-legacy';

function setupKeystone(provider: ProviderName) {
  return setupFromConfig({
    provider,
    config: testConfig({
      lists: createSchema({
        // Imperative -> Static access control
        User: list({
          fields: {
            other: text(),
            name: text({
              access: {
                read: true,
                create: ({ originalInput }) => {
                  if (Array.isArray(originalInput)) {
                    return !originalInput.some(item => item.data.name === 'bad');
                  } else {
                    return (originalInput as any).name !== 'bad';
                  }
                },
                update: ({ originalInput }) => {
                  if (Array.isArray(originalInput)) {
                    return !originalInput.some(item => item.data.name === 'bad');
                  } else {
                    return (originalInput as any).name !== 'bad';
                  }
                },
              },
            }),
          },
        }),
      }),
    }),
  });
}

multiAdapterRunners().map(({ runner, provider }) =>
  describe(`Provider: ${provider}`, () => {
    describe('Access control - Imperative => static', () => {
      test(
        'createOne',
        runner(setupKeystone, async ({ context }) => {
          context = context.exitSudo();
          // Valid name should pass
          await context.lists.User.createOne({ data: { name: 'good', other: 'a' } });

          // Invalid name
          const { data, errors } = await context.graphql.raw({
            query: `mutation ($data: UserCreateInput) { createUser(data: $data) { id } }`,
            variables: { data: { name: 'bad', other: 'b' } },
          });

          // Returns null and throws an error
          expect(data!.createUser).toBe(null);
          expect(errors).toHaveLength(1);
          expect(errors![0].message).toEqual('You do not have access to this resource');
          expect(errors![0].path).toEqual(['createUser']);

          // Only the original user should exist
          const _users = await context.lists.User.findMany({ query: 'id name other' });
          expect(_users.map(({ name }) => name)).toEqual(['good']);
          expect(_users.map(({ other }) => other)).toEqual(['a']);
        })
      );

      test(
        'updateOne',
        runner(setupKeystone, async ({ context }) => {
          context = context.exitSudo();
          // Valid name should pass
          const user = await context.lists.User.createOne({ data: { name: 'good', other: 'a' } });
          await context.lists.User.updateOne({ id: user.id, data: { name: 'better', other: 'b' } });

          // Invalid name
          const { data, errors } = await context.graphql.raw({
            query: `mutation ($id: ID! $data: UserUpdateInput) { updateUser(id: $id data: $data) { id } }`,
            variables: { id: user.id, data: { name: 'bad', other: 'c' } },
          });

          // Returns null and throws an error
          expect(data!.updateUser).toBe(null);
          expect(errors).toHaveLength(1);
          expect(errors![0].message).toEqual('You do not have access to this resource');
          expect(errors![0].path).toEqual(['updateUser']);

          // User should have its original name
          const _users = await context.lists.User.findMany({ query: 'id name other' });
          expect(_users.map(({ name }) => name)).toEqual(['better']);
          expect(_users.map(({ other }) => other)).toEqual(['b']);
        })
      );

      test(
        'createMany',
        runner(setupKeystone, async ({ context }) => {
          context = context.exitSudo();
          // Mix of good and bad names
          const { data, errors } = await context.graphql.raw({
            query: `mutation ($data: [UsersCreateInput]) { createUsers(data: $data) { id name } }`,
            variables: {
              data: [
                { data: { name: 'good 1', other: 'a' } },
                { data: { name: 'bad', other: 'a' } },
                { data: { name: 'good 2', other: 'a' } },
                { data: { name: 'bad', other: 'a' } },
                { data: { name: 'good 3', other: 'a' } },
              ],
            },
          });

          // Errors out before any users are created
          expect(data!.createUsers).toBe(null);

          // A single error message for the whole operation
          expect(errors).toHaveLength(1);
          expect(errors![0].message).toEqual('You do not have access to this resource');
          expect(errors![0].path).toEqual(['createUsers']);

          // No users should exist in the database
          const users = await context.lists.User.findMany();
          expect(users).toEqual([]);
        })
      );

      test(
        'updateMany',
        runner(setupKeystone, async ({ context }) => {
          context = context.exitSudo();
          // Start with some users
          const users = await context.lists.User.createMany({
            data: [
              { data: { name: 'good 1', other: 'a' } },
              { data: { name: 'good 2', other: 'a' } },
              { data: { name: 'good 3', other: 'a' } },
              { data: { name: 'good 4', other: 'a' } },
              { data: { name: 'good 5', other: 'a' } },
            ],
            query: 'id name',
          });

          // Mix of good and bad names
          const { data, errors } = await context.graphql.raw({
            query: `mutation ($data: [UsersUpdateInput]) { updateUsers(data: $data) { id name } }`,
            variables: {
              data: [
                { id: users[0].id, data: { name: 'still good 1', other: 'b' } },
                { id: users[1].id, data: { name: 'bad', other: 'b' } },
                { id: users[2].id, data: { name: 'still good 3', other: 'b' } },
                { id: users[3].id, data: { name: 'bad', other: 'b' } },
              ],
            },
          });

          // Errors out before any users are created
          expect(data!.updateUsers).toBe(null);

          // A single error message for the whole operation
          expect(errors).toHaveLength(1);
          expect(errors![0].message).toEqual('You do not have access to this resource');
          expect(errors![0].path).toEqual(['updateUsers']);

          // All users should still exist in the database
          const _users = await context.lists.User.findMany({
            sortBy: 'name_ASC',
            query: 'id name other',
          });
          expect(_users.map(({ name }) => name)).toEqual([
            'good 1',
            'good 2',
            'good 3',
            'good 4',
            'good 5',
          ]);
          expect(_users.map(({ other }) => other)).toEqual(['a', 'a', 'a', 'a', 'a']);
        })
      );
    });
  })
);
