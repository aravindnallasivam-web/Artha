using System.Text;
using Artha.Auth.Configuration;
using Artha.Auth.Google;
using Artha.Auth.Jwt;
using Artha.Auth.Storage;
using Artha.Core.Auth;
using Artha.Core.Drive;
using Artha.Drive;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;
using Serilog;

const string CorsPolicyName = "ArthaClient";

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, services, configuration) => configuration
    .ReadFrom.Configuration(context.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext()
    .WriteTo.Console());

builder.Services.AddDataProtection();

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

builder.Services.Configure<GoogleAuthOptions>(
    builder.Configuration.GetSection(GoogleAuthOptions.SectionName));
builder.Services.Configure<JwtOptions>(
    builder.Configuration.GetSection(JwtOptions.SectionName));

builder.Services.AddHttpClient<IExternalIdentityProvider, GoogleIdentityProvider>();
builder.Services.AddSingleton<ArthaJwtIssuer>();
builder.Services.AddSingleton<IUserTokenStore, InMemoryUserTokenStore>();

builder.Services.AddMemoryCache();
builder.Services.AddScoped<IDriveClientFactory, GoogleDriveClientFactory>();
builder.Services.AddScoped<AppDataBootstrapper>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(JwtBearerDefaults.AuthenticationScheme, options =>
    {
        var jwt = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>()
            ?? throw new InvalidOperationException("Jwt section is missing from configuration.");

        if (string.IsNullOrWhiteSpace(jwt.SigningKey) || jwt.SigningKey.Length < 32)
        {
            throw new InvalidOperationException(
                "Jwt:SigningKey must be configured and at least 32 characters long.");
        }

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SigningKey)),
            ClockSkew = TimeSpan.FromMinutes(1),
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicyName, policy =>
    {
        var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
            ?? new[] { "http://localhost:4200", "http://localhost:8100", "capacitor://localhost", "ionic://localhost" };

        policy.WithOrigins(origins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

builder.Services.AddControllers()
    .ConfigureApiBehaviorOptions(options =>
    {
        options.InvalidModelStateResponseFactory = context =>
        {
            var problem = new ValidationProblemDetails(context.ModelState)
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "Request validation failed",
            };
            return new BadRequestObjectResult(problem);
        };
    });

builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();
builder.Services.AddEndpointsApiExplorer();

var app = builder.Build();

app.UseForwardedHeaders();
app.UseSerilogRequestLogging();
app.UseExceptionHandler();
app.UseStatusCodePages();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseHttpsRedirection();
}

// Serve the Angular SPA from wwwroot (populated at publish time by the
// PublishSpa target in Artha.Api.csproj). In development the SpaProxy
// middleware proxies these routes to `ng serve` instead.
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors(CorsPolicyName);
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

// Any non-API request that didn't match a static file falls through to
// index.html so client-side routing (login, callback, dashboard, ...) works
// on direct navigation and page refresh.
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
