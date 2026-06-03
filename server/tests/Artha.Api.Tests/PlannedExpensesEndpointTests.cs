using System.Net;
using System.Net.Http.Json;
using Artha.Api.Dtos;
using Artha.Api.Tests.Infrastructure;
using FluentAssertions;

namespace Artha.Api.Tests;

public sealed class PlannedExpensesEndpointTests : IClassFixture<ArthaTestFactory>
{
    private readonly ArthaTestFactory _factory;

    public PlannedExpensesEndpointTests(ArthaTestFactory factory)
    {
        _factory = factory;
    }

    private HttpClient AuthedClient(string userId)
    {
        var client = _factory.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.UserHeader, userId);
        return client;
    }

    [Fact]
    public async Task Get_Bootstrap_ReturnsEmptyList()
    {
        var client = AuthedClient("user-planned-empty");

        var items = await client.GetFromJsonAsync<List<PlannedExpenseDto>>("/api/planned-expenses");

        items.Should().NotBeNull();
        items!.Should().BeEmpty();
    }

    [Fact]
    public async Task Post_AddsPlannedExpense()
    {
        var client = AuthedClient("user-planned-add");

        var response = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Rent", 1200m, "cat-bills", 1));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var list = await client.GetFromJsonAsync<List<PlannedExpenseDto>>("/api/planned-expenses");
        list.Should().ContainSingle(p =>
            p.Name == "Rent" &&
            p.Amount == 1200m &&
            p.CategoryId == "cat-bills" &&
            p.DayOfMonth == 1 &&
            !p.Archived);
    }

    [Fact]
    public async Task Post_WithoutCategoryOrDay_Succeeds()
    {
        var client = AuthedClient("user-planned-minimal");

        var response = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Broadband", 40m, null, null));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var dto = await response.Content.ReadFromJsonAsync<PlannedExpenseDto>();
        dto!.CategoryId.Should().BeNull();
        dto.DayOfMonth.Should().BeNull();
    }

    [Fact]
    public async Task Post_NonPositiveAmount_Returns400()
    {
        var client = AuthedClient("user-planned-bad-amount");

        var response = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Free thing", 0m, null, null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Post_InvalidDayOfMonth_Returns400()
    {
        var client = AuthedClient("user-planned-bad-day");

        var response = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Rent", 100m, null, 32));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Post_UnknownCategory_Returns400()
    {
        var client = AuthedClient("user-planned-bad-cat");

        var response = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Rent", 100m, "cat-nonexistent", null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Post_DuplicateName_Returns400()
    {
        var client = AuthedClient("user-planned-dup");

        await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Rent", 100m, null, null));
        var second = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("RENT", 200m, null, null));

        second.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Put_UpdatesPlannedExpense()
    {
        var client = AuthedClient("user-planned-update");

        var created = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Broadband", 40m, null, 5));
        var dto = await created.Content.ReadFromJsonAsync<PlannedExpenseDto>();

        var put = await client.PutAsJsonAsync($"/api/planned-expenses/{dto!.Id}",
            new PlannedExpenseUpsertRequest("Broadband Pro", 55m, "cat-bills", 10));
        put.StatusCode.Should().Be(HttpStatusCode.OK);

        var list = await client.GetFromJsonAsync<List<PlannedExpenseDto>>("/api/planned-expenses");
        list.Should().ContainSingle(p =>
            p.Name == "Broadband Pro" && p.Amount == 55m && p.DayOfMonth == 10);
    }

    [Fact]
    public async Task Delete_SoftDeletes()
    {
        var client = AuthedClient("user-planned-archive");

        var created = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Gym", 30m, null, null));
        var dto = await created.Content.ReadFromJsonAsync<PlannedExpenseDto>();

        var del = await client.DeleteAsync($"/api/planned-expenses/{dto!.Id}");
        del.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var visible = await client.GetFromJsonAsync<List<PlannedExpenseDto>>("/api/planned-expenses");
        visible.Should().NotContain(p => p.Id == dto.Id);

        var withArchived = await client.GetFromJsonAsync<List<PlannedExpenseDto>>(
            "/api/planned-expenses?includeArchived=true");
        withArchived.Should().Contain(p => p.Id == dto.Id && p.Archived);
    }

    [Fact]
    public async Task MonthlyReport_IncludesPlannedTotal()
    {
        var client = AuthedClient("user-planned-report");

        await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Rent", 1000m, null, 1));
        await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Broadband", 50m, null, 5));

        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 5, 3), 200m, "cat-food", "acc-cash", null));

        var report = await client.GetFromJsonAsync<MonthlyReportDto>(
            "/api/reports/monthly?year=2026&month=5");

        report.Should().NotBeNull();
        report!.PlannedTotal.Should().Be(1050m);
        report.PlannedCount.Should().Be(2);
        report.Total.Should().Be(200m);
    }
}
