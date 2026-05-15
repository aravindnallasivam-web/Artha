using System.Security.Claims;
using Artha.Api.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Artha.Api.Controllers;

[ApiController]
[Route("api/me")]
[Authorize]
public sealed class MeController : ControllerBase
{
    [HttpGet]
    public ActionResult<UserDto> Get()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        var email = User.FindFirstValue(ClaimTypes.Email) ?? User.FindFirstValue("email");
        var name = User.FindFirstValue("name") ?? email ?? string.Empty;
        var picture = User.FindFirstValue("picture");

        if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(email))
        {
            return Unauthorized();
        }

        return Ok(new UserDto(id, email, name, picture));
    }
}
