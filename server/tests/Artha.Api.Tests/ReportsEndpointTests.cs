using System.Net.Http.Json;
using Artha.Api.Dtos;
using Artha.Api.Tests.Infrastructure;
using FluentAssertions;

namespace Artha.Api.Tests;

public sealed class ReportsEndpointTests : IClassFixture<ArthaTestFactory>
{
    private readonly ArthaTestFactory _factory;

    public ReportsEndpointTests(ArthaTestFactory factory)
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
    public async Task Monthly_EmptyMonth_ReturnsZeroTotal()
    {
        var client = AuthedClient("user-reports-empty");

        var report = await client.GetFromJsonAsync<MonthlyReportDto>(
            "/api/reports/monthly?year=2026&month=5");

        report.Should().NotBeNull();
        report!.Total.Should().Be(0m);
        report.Count.Should().Be(0);
        report.ByCategory.Should().BeEmpty();
        report.Year.Should().Be(2026);
        report.Month.Should().Be(5);
    }

    [Fact]
    public async Task Monthly_AggregatesByCategory()
    {
        var client = AuthedClient("user-reports-monthly");

        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 5, 1), 10m, "cat-food", "acc-cash", null));
        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 5, 15), 20m, "cat-food", "acc-cash", null));
        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 5, 20), 50m, "cat-transport", "acc-cash", null));

        var report = await client.GetFromJsonAsync<MonthlyReportDto>(
            "/api/reports/monthly?year=2026&month=5");

        report.Should().NotBeNull();
        report!.Total.Should().Be(80m);
        report.Count.Should().Be(3);
        report.ByCategory.Should().HaveCount(2);

        // Sorted desc by total.
        report.ByCategory[0].CategoryName.Should().Be("Transport");
        report.ByCategory[0].Total.Should().Be(50m);
        report.ByCategory[0].Count.Should().Be(1);

        report.ByCategory[1].CategoryName.Should().Be("Food");
        report.ByCategory[1].Total.Should().Be(30m);
        report.ByCategory[1].Count.Should().Be(2);
    }

    [Fact]
    public async Task Monthly_OnlyIncludesThatMonth()
    {
        var client = AuthedClient("user-reports-cross-month");

        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 4, 25), 100m, "cat-food", "acc-cash", "april"));
        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 5, 1), 5m, "cat-food", "acc-cash", "may"));

        var may = await client.GetFromJsonAsync<MonthlyReportDto>(
            "/api/reports/monthly?year=2026&month=5");

        may!.Total.Should().Be(5m);
        may.Count.Should().Be(1);
    }

    [Fact]
    public async Task Yearly_ReturnsAll12Months()
    {
        var client = AuthedClient("user-reports-yearly-empty");

        var report = await client.GetFromJsonAsync<YearlyReportDto>(
            "/api/reports/yearly?year=2026");

        report.Should().NotBeNull();
        report!.Months.Should().HaveCount(12);
        report.Months.Select(m => m.Month).Should().Equal(Enumerable.Range(1, 12));
        report.YearTotal.Should().Be(0m);
    }

    [Fact]
    public async Task Yearly_AggregatesAcrossMonths()
    {
        var client = AuthedClient("user-reports-yearly");

        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 1, 5), 10m, "cat-food", "acc-cash", null));
        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 5, 15), 20m, "cat-food", "acc-cash", null));
        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 5, 20), 30m, "cat-transport", "acc-cash", null));
        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 12, 1), 40m, "cat-bills", "acc-cash", null));

        var report = await client.GetFromJsonAsync<YearlyReportDto>(
            "/api/reports/yearly?year=2026");

        report!.YearTotal.Should().Be(100m);
        report.YearCount.Should().Be(4);

        report.Months.First(m => m.Month == 1).Total.Should().Be(10m);
        report.Months.First(m => m.Month == 5).Total.Should().Be(50m);
        report.Months.First(m => m.Month == 5).Count.Should().Be(2);
        report.Months.First(m => m.Month == 12).Total.Should().Be(40m);
        report.Months.First(m => m.Month == 7).Total.Should().Be(0m);

        // 3 categories in play, sorted desc by total: Bills 40, Food 30, Transport 30.
        report.ByCategory.Should().HaveCount(3);
        report.ByCategory[0].CategoryName.Should().Be("Bills");
        report.ByCategory[0].Total.Should().Be(40m);
    }

    [Fact]
    public async Task Monthly_ExcludesNonExpensesFromTotals_ButListKeepsThem()
    {
        var client = AuthedClient("user-reports-excluded");

        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 5, 2), 40m, "cat-food", "acc-cash", "lunch"));
        // A refund/transfer flagged as a non-expense — must not count toward totals.
        await client.PostAsJsonAsync("/api/expenses",
            new ExpenseCreateRequest(new DateOnly(2026, 5, 3), 500m, "cat-food", "acc-cash", "refund", Excluded: true));

        var report = await client.GetFromJsonAsync<MonthlyReportDto>(
            "/api/reports/monthly?year=2026&month=5");

        report!.Total.Should().Be(40m);
        report.Count.Should().Be(1);
        report.ByCategory.Should().ContainSingle();
        report.ByCategory[0].Total.Should().Be(40m);

        // The excluded row is still stored and returned by the list endpoint.
        var list = await client.GetFromJsonAsync<ExpenseListResponse>(
            "/api/expenses?from=2026-05&to=2026-05");
        list!.Items.Should().HaveCount(2);
        list.Items.Should().ContainSingle(e => e.Excluded);
    }

    [Fact]
    public async Task Monthly_InvalidMonth_Returns400()
    {
        var client = AuthedClient("user-reports-bad");

        var response = await client.GetAsync("/api/reports/monthly?year=2026&month=13");

        response.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
    }
}
