using Artha.Core.Drive;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Artha.Api.Tests.Infrastructure;

public sealed class ArthaTestFactory : WebApplicationFactory<Program>
{
    public InMemoryDriveClientFactory DriveFactory { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Jwt:SigningKey", "test-signing-key-must-be-at-least-32-characters");
        builder.UseSetting("Jwt:Issuer", "test-issuer");
        builder.UseSetting("Jwt:Audience", "test-audience");
        builder.UseSetting("GoogleAuth:ClientId", "test-client-id");
        builder.UseSetting("GoogleAuth:ClientSecret", "test-client-secret");

        builder.ConfigureTestServices(services =>
        {
            // Replace JWT bearer authn with a synthetic test scheme so we can
            // hit [Authorize] endpoints without minting real JWTs.
            services.AddAuthentication(defaultScheme: TestAuthHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(
                    TestAuthHandler.SchemeName, _ => { });

            // Swap the real Drive factory (which requires Google OAuth tokens)
            // for an in-memory one. The test can prime data via DriveFactory.For(userId).
            services.RemoveAll<IDriveClientFactory>();
            services.AddSingleton<IDriveClientFactory>(DriveFactory);
        });
    }
}

file static class ServiceCollectionExtensions
{
    public static void RemoveAll<T>(this IServiceCollection services)
    {
        for (var i = services.Count - 1; i >= 0; i--)
        {
            if (services[i].ServiceType == typeof(T))
            {
                services.RemoveAt(i);
            }
        }
    }
}
