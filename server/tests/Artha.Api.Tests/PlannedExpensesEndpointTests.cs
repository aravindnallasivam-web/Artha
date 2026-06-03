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
            new PlannedExpenseUpsertRequest("Rent", 1200m, "monthly", "cat-bills", 1));
        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var list = await client.GetFromJsonAsync<List<PlannedExpenseDto>>("/api/planned-expenses");
        list.Should().ContainSingle(p =>
            p.Name == "Rent" &&
            p.Amount == 1200m &&
            p.Frequency == "monthly" &&
            p.CategoryId == "cat-bills" &&
            p.DayOfMonth == 1 &&
            !p.Archived);
    }

    [Fact]
    public async Task Post_PersistsYearlyFrequency()
    {
        var client = AuthedClient("user-planned-yearly");

        var response = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Insurance", 12000m, "yearly", null, null));
        var dto = await response.Content.ReadFromJsonAsync<PlannedExpenseDto>();

        dto!.Frequency.Should().Be("yearly");
    }

    [Fact]
    public async Task Post_UnknownFrequency_NormalisesToMonthly()
    {
        var client = AuthedClient("user-planned-bad-freq");

        var response = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Mystery", 10m, "fortnightly", null, null));
        var dto = await response.Content.ReadFromJsonAsync<PlannedExpenseDto>();

        dto!.Frequency.Should().Be("monthly");
    }

    [Fact]
    public async Task Post_NonPositiveAmount_Returns400()
    {
        var client = AuthedClient("user-planned-bad-amount");

        var response = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Free thing", 0m, "monthly", null, null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Post_InvalidDayOfMonth_Returns400()
    {
        var client = AuthedClient("user-planned-bad-day");

        var response = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Rent", 100m, "monthly", null, 32));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Post_UnknownCategory_Returns400()
    {
        var client = AuthedClient("user-planned-bad-cat");

        var response = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Rent", 100m, "monthly", "cat-nonexistent", null));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Post_DuplicateName_Returns400()
    {
        var client = AuthedClient("user-planned-dup");

        await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Rent", 100m, "monthly", null, null));
        var second = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("RENT", 200m, "monthly", null, null));

        second.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Put_UpdatesPlannedExpense()
    {
        var client = AuthedClient("user-planned-update");

        var created = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Broadband", 40m, "monthly", null, 5));
        var dto = await created.Content.ReadFromJsonAsync<PlannedExpenseDto>();

        var put = await client.PutAsJsonAsync($"/api/planned-expenses/{dto!.Id}",
            new PlannedExpenseUpsertRequest("Broadband Pro", 55m, "quarterly", "cat-bills", 10));
        put.StatusCode.Should().Be(HttpStatusCode.OK);

        var list = await client.GetFromJsonAsync<List<PlannedExpenseDto>>("/api/planned-expenses");
        list.Should().ContainSingle(p =>
            p.Name == "Broadband Pro" && p.Amount == 55m && p.Frequency == "quarterly" && p.DayOfMonth == 10);
    }

    [Fact]
    public async Task Delete_SoftDeletes()
    {
        var client = AuthedClient("user-planned-archive");

        var created = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Gym", 30m, "monthly", null, null));
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
    public async Task MonthlyReport_NormalisesPlannedTotalToMonthly()
    {
        var client = AuthedClient("user-planned-report");

        // 1000/mo + 12000/yr (=1000/mo) => 2000/mo planned budget.
        await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Rent", 1000m, "monthly", null, 1));
        await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Insurance", 12000m, "yearly", null, null));

        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 5, 3), 200m, "cat-food", "acc-cash", null));

        var report = await client.GetFromJsonAsync<MonthlyReportDto>(
            "/api/reports/monthly?year=2026&month=5");

        report.Should().NotBeNull();
        report!.PlannedTotal.Should().Be(2000m);
        report.PlannedCount.Should().Be(2);
        report.Total.Should().Be(200m);
    }

    [Fact]
    public async Task Expense_PersistsPlannedExpenseLink()
    {
        var client = AuthedClient("user-expense-link");

        var planned = await client.PostAsJsonAsync("/api/planned-expenses",
            new PlannedExpenseUpsertRequest("Rent", 1000m, "monthly", "cat-bills", 1));
        var plan = await planned.Content.ReadFromJsonAsync<PlannedExpenseDto>();

        await client.PostAsJsonAsync("/api/expenses", new ExpenseCreateRequest(
            new DateOnly(2026, 5, 1), 1000m, "cat-bills", "acc-cash", "May rent", false, plan!.Id));

        var list = await client.GetFromJsonAsync<ExpenseListResponse>("/api/expenses?from=2026-05&to=2026-05");
        list!.Items.Should().ContainSingle(e => e.PlannedExpenseId == plan.Id);
    }
}
