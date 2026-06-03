using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Artha.Api.Controllers;

[ApiController]
[Route("api/health")]
[AllowAnonymous]
public sealed class HealthController : ControllerBase
{
    // `features` lets a deployed build be identified without auth — e.g.
    // `curl /api/health` should list "account-bank-sync" once this build is live.
    [HttpGet]
    public IActionResult Get() => Ok(new
    {
        status = "ok",
        time = DateTimeOffset.UtcNow,
        features = new[] { "account-bank-sync" },
    });
}
